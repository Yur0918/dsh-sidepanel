// dsh-sidepanel host half: same-origin /sidepanel/* HTTP routes over the
// webServer service. Zero package imports beyond node builtins.
//
// Surfaces:
//   GET  /sidepanel/health
//   GET  /sidepanel/artifacts?sessionId=&scan=1     produced-file view for one session
//   GET  /sidepanel/file?sessionId=&path=           safe preview (cwd-containment + realpath)
//   POST /sidepanel/reveal                          Finder reveal (same safety as preview)
//   GET  /sidepanel/chat/state?sessionId=           side-chat transcript replay (fork child)
//   GET  /sidepanel/chat/models                     model catalog (same llm service as the main picker)
//   (POST /sidepanel/chat/send accepts { model })   switch routing → starts a NEW fork child
//   POST /sidepanel/chat/send                       send to the session's side-chat child
//   POST /sidepanel/chat/stop                       interrupt the running side-chat turn
//   GET  /sidepanel/chat/stream?sessionId=          SSE live stream of the side-chat child
//
// The side chat is a continuable "fork" subagent child of the target session:
// it inherits the parent's completed-turn context, shares the parent's model,
// and never writes into the parent transcript (so the main chat is untouched).

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { zstdDecompressSync } from "node:zlib";

export const inject = ["webServer"];

const VERSION = "1.3.6";
const CHAT_LABEL = "sidepanel-chat";
const TEXT_LIMIT_BYTES = 512 * 1024;
const IMAGE_LIMIT_BYTES = 8 * 1024 * 1024;
const SCAN_MAX_DEPTH = 8;
const SCAN_MAX_VISITS = 4000;
const SCAN_MAX_ITEMS = 300;
const SCAN_MAX_FILE_BYTES = 64 * 1024 * 1024;
const CHAT_TEXT_LIMIT = 32 * 1024;

const TEXT_EXTS = new Set([
	"txt", "md", "markdown", "json", "yaml", "yml", "toml", "ini", "conf", "cfg", "env", "log",
	"js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "kt", "swift",
	"c", "h", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh", "fish", "sql", "html", "htm",
	"css", "scss", "less", "vue", "svelte", "xml", "svg", "csv", "tsv", "diff", "patch", "gitignore"
]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "ico"]);
const IMAGE_MIME = {
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
	webp: "image/webp", bmp: "image/bmp", avif: "image/avif", ico: "image/x-icon"
};
const SCAN_SKIP_DIRS = new Set([
	"node_modules", ".git", ".hg", ".svn", "dist", "build", "out", ".next", ".nuxt", ".venv",
	"venv", "__pycache__", ".cache", ".gradle", "target", "DerivedData", ".DS_Store", "coverage"
]);

function dshHome() {
	if (process.env.DSH_HOME && process.env.DSH_HOME.trim() !== "") return process.env.DSH_HOME;
	return path.join(os.homedir(), ".dsh");
}

// ── pure helpers (exported for unit tests) ───────────────────────────────────

const ZSTD_MAGIC = 0xfd2fb528;

function parseZstdFrames(buf) {
	const frames = [];
	let offset = 0;
	while (offset + 4 <= buf.length) {
		const start = offset;
		if (buf.readUInt32LE(offset) !== ZSTD_MAGIC) return { frames, tornFrom: start === 0 ? start : null };
		offset += 4;
		if (offset >= buf.length) return { frames, tornFrom: start };
		const descriptor = buf.readUInt8(offset);
		offset += 1;
		if ((descriptor & 24) !== 0) return { frames, tornFrom: start };
		const fcsFlag = descriptor >>> 6;
		const singleSegment = (descriptor & 32) !== 0;
		const checksum = (descriptor & 4) !== 0;
		const dictFlag = descriptor & 3;
		if (!singleSegment) offset += 1;
		offset += dictFlag === 3 ? 4 : dictFlag;
		offset += fcsFlag === 3 ? 8 : fcsFlag === 2 ? 4 : fcsFlag === 1 ? 2 : (singleSegment ? 1 : 0);
		let last = false;
		while (!last) {
			if (offset + 3 > buf.length) return { frames, tornFrom: start };
			const header = buf.readUIntLE(offset, 3);
			offset += 3;
			last = (header & 1) !== 0;
			offset += header >>> 3;
			if (offset > buf.length) return { frames, tornFrom: start };
		}
		if (checksum) offset += 4;
		if (offset > buf.length) return { frames, tornFrom: start };
		frames.push([start, offset]);
	}
	return { frames, tornFrom: null };
}

function decodeZstdLog(buf) {
	const { frames } = parseZstdFrames(buf);
	const parts = [];
	for (const [start, end] of frames) {
		try {
			parts.push(zstdDecompressSync(buf.subarray(start, end)));
		} catch {
			break;
		}
	}
	return Buffer.concat(parts).toString("utf8");
}

function firstTextOf(content) {
	if (!Array.isArray(content)) return "";
	for (const block of content) {
		if (block !== null && typeof block === "object" && block.type === "text" && typeof block.text === "string") return block.text;
	}
	return "";
}

function textBlocksOf(content) {
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) {
		if (block !== null && typeof block === "object" && block.type === "text" && typeof block.text === "string" && block.text !== "") parts.push(block.text);
	}
	return parts.join("\n");
}

// Mutation tools whose calls carry produced file paths. Values describe how the
// raw path argument is located and how the op is named.
const MUTATION_TOOLS = {
	write: { pathKeys: ["file_path"], op: "write" },
	edit: { pathKeys: ["file_path"], op: "edit" },
	str_replace_editor: { pathKeys: ["path"], op: null } // op = args.command (view is a read)
};

// Fold one decoded session log into the facts the panel needs:
// header (id/cwd/createdAt), display title, last model context, the produced
// map (path -> merged tool evidence), and a user/assistant transcript.
function foldSessionLog(text) {
	const fold = {
		header: null,
		title: "",
		lastContext: null,
		produced: new Map(), // rawPath -> { ops:[], tools:Set, firstTime, lastTime, ok, count }
		messages: []
	};
	const openCalls = new Map(); // callId -> rawPath (mutations only)
	let started = 0;
	while (started < text.length) {
		const nl = text.indexOf("\n", started);
		const line = nl === -1 ? text.slice(started) : text.slice(started, nl);
		started = nl === -1 ? text.length : nl + 1;
		if (line.trim() === "") continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue; // truncated tail during live appends
		}
		const type = event.type;
		const data = event.data;
		if (type === "session") {
			const header = data !== null && typeof data === "object" ? data : event;
			fold.header = {
				id: typeof header.id === "string" ? header.id : "",
				cwd: typeof header.cwd === "string" ? header.cwd : "",
				createdAt: Number(header.createdAt ?? 0) || 0,
				parentSession: typeof header.parentSession === "string" ? header.parentSession : null,
				origin: typeof header.origin === "string" ? header.origin : null,
				seedLength: Number(header.seedLength ?? 0) || 0
			};
			continue;
		}
		if (type === "session/title") {
			const title = typeof data === "string" ? data : data?.title;
			if (typeof title === "string" && title.trim() !== "") fold.title = title.trim();
			continue;
		}
		if (type === "request/context" && data !== null && typeof data === "object" && typeof data.provider === "string") {
			fold.lastContext = { provider: data.provider, model: typeof data.model === "string" ? data.model : "", contextWindow: Number(data.contextWindow ?? 0) || 0, seq: Number(event.seq ?? 0) || 0 };
			continue;
		}
		if (type === "tool/call" && data !== null && typeof data === "object") {
			const spec = MUTATION_TOOLS[data.name];
			if (spec === undefined) continue;
			let args = {};
			try {
				args = JSON.parse(typeof data.arguments === "string" ? data.arguments : "{}");
			} catch {
				continue;
			}
			let rawPath = "";
			for (const key of spec.pathKeys) {
				if (typeof args[key] === "string" && args[key].trim() !== "") {
					rawPath = args[key];
					break;
				}
			}
			if (rawPath === "") continue;
			const op = spec.op ?? (typeof args.command === "string" ? args.command : "edit");
			if (op === "view") continue; // reads are not artifacts
			openCalls.set(data.callId, { rawPath, op, tool: data.name, time: Number(event.time ?? 0) || 0 });
			continue;
		}
		if (type === "tool/result" && data !== null && typeof data === "object") {
			const callId = data.message?.content?.[0]?.toolCallId;
			const open = openCalls.get(callId);
			if (open === undefined) continue;
			openCalls.delete(callId);
			const isError = data.message?.content?.[0]?.isError === true;
			let entry = fold.produced.get(open.rawPath);
			if (entry === undefined) {
				entry = { ops: [], tools: new Set(), firstTime: open.time, lastTime: open.time, ok: !isError, count: 0 };
				fold.produced.set(open.rawPath, entry);
			}
			if (!entry.ops.includes(open.op)) entry.ops.push(open.op);
			entry.tools.add(open.tool);
			entry.count += 1;
			entry.lastTime = Math.max(entry.lastTime, open.time);
			if (!isError) entry.ok = true;
			continue;
		}
		if (type === "user/message" && data !== null && typeof data === "object") {
			const sourceKind = data.source?.kind;
			// tool results ride user/message events with kind "tool"; the side
			// chat's own turns arrive as user / coordinator deliveries
			if (sourceKind === "tool") continue;
			if (sourceKind === "user" || sourceKind === "coordinator") {
				const text = firstTextOf(data.content);
				if (text.trim() !== "") fold.messages.push({ role: "user", text, time: Number(event.time ?? 0) || 0, seq: Number(event.seq ?? 0) || 0 });
			}
			continue;
		}
		if (type === "assistant/message" && data !== null && typeof data === "object") {
			const text = textBlocksOf(data.message?.content);
			const interrupted = data.interrupted === true;
			// keep empty-but-interrupted replies so the marker survives replay
			if (text.trim() !== "" || interrupted) {
				fold.messages.push({ role: "assistant", text, time: Number(event.time ?? 0) || 0, seq: Number(event.seq ?? 0) || 0, interrupted });
			}
			continue;
		}
	}
	// fork children inherit the parent's prefix verbatim; only messages at or
	// after the header's seedLength are the child's own exchanges
	const seedLength = fold.header?.seedLength ?? 0;
	if (seedLength > 0) {
		const idx = fold.messages.findIndex((m) => m.seq >= seedLength);
		fold.ownStart = idx === -1 ? fold.messages.length : idx;
	} else {
		fold.ownStart = 0;
	}
	return fold;
}

function extOf(name) {
	const base = path.basename(String(name ?? ""));
	const dot = base.lastIndexOf(".");
	return dot <= 0 || dot === base.length - 1 ? "" : base.slice(dot + 1).toLowerCase();
}

function classifyKind(name) {
	const ext = extOf(name);
	if (IMAGE_EXTS.has(ext)) return "image";
	if (TEXT_EXTS.has(ext)) return "text";
	if (ext === "") return "text"; // extensionless files are usually text-ish
	return "binary";
}

// Pure containment math (no fs): candidate must resolve strictly inside base.
function resolveInside(base, candidate) {
	if (typeof base !== "string" || base === "" || typeof candidate !== "string" || candidate === "") return { ok: false, reason: "invalid" };
	const abs = path.resolve(base, candidate);
	if (abs === base) return { ok: false, reason: "is-base" };
	const rel = path.relative(base, abs);
	if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return { ok: false, reason: "escapes-base", abs };
	return { ok: true, abs, rel };
}

export const _pure = {
	parseZstdFrames,
	decodeZstdLog,
	foldSessionLog,
	classifyKind,
	extOf,
	resolveInside,
	safeResolveForRead,
	buildArtifacts,
	buildPreview,
	MUTATION_TOOLS
};

// ── session log access ───────────────────────────────────────────────────────

const foldCache = new Map(); // file -> {mtimeMs, size, fold}

async function statOrNull(file) {
	try {
		return await fsp.stat(file);
	} catch {
		return null;
	}
}

async function findSessionFile(sessionId) {
	if (typeof sessionId !== "string" || !/^[\w.-]{1,120}$/.test(sessionId)) return null;
	const roots = [path.join(dshHome(), "sessions")];
	try {
		const routesRoot = path.join(os.homedir(), ".dsh-routes");
		for (const entry of await fsp.readdir(routesRoot, { withFileTypes: true })) {
			if (entry.isDirectory()) roots.push(path.join(routesRoot, entry.name, "sessions"));
		}
	} catch {
		// no bridge routes
	}
	for (const root of roots) {
		let projectDirs;
		try {
			projectDirs = await fsp.readdir(root, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const project of projectDirs) {
			if (!project.isDirectory()) continue;
			for (const name of ["session.jsonl.zstd", "session.jsonl"]) {
				const file = path.join(root, project.name, sessionId, name);
				const stat = await statOrNull(file);
				if (stat !== null && stat.isFile()) return { file, stat };
			}
		}
	}
	return null;
}

async function readSessionFold(sessionId) {
	const found = await findSessionFile(sessionId);
	if (found === null) return null;
	const { file, stat } = found;
	const cached = foldCache.get(file);
	if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.fold;
	let text;
	if (file.endsWith(".zstd")) {
		text = decodeZstdLog(await fsp.readFile(file));
	} else {
		text = await fsp.readFile(file, "utf8");
	}
	const fold = foldSessionLog(text);
	if (fold.header !== null && fold.header.id !== "" && fold.header.id !== sessionId) {
		// directory name and header disagree: trust the header, refuse to serve
		return fold.header.id === sessionId ? fold : { ...fold, mismatch: true };
	}
	foldCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, fold });
	if (foldCache.size > 80) {
		const first = foldCache.keys().next().value;
		foldCache.delete(first);
	}
	return fold;
}

// ── artifacts view ───────────────────────────────────────────────────────────

async function scanWorkspace(cwd, sinceMs, excludeAbs) {
	const found = [];
	let visits = 0;
	const since = sinceMs > 0 ? sinceMs - 60000 : 0; // tolerate small clock skew
	async function walk(dir, depth) {
		if (found.length >= SCAN_MAX_ITEMS || visits >= SCAN_MAX_VISITS || depth > SCAN_MAX_DEPTH) return;
		visits += 1;
		let entries;
		try {
			entries = await fsp.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (found.length >= SCAN_MAX_ITEMS || visits >= SCAN_MAX_VISITS) return;
			const abs = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (SCAN_SKIP_DIRS.has(entry.name) || entry.name.startsWith(".git")) continue;
				await walk(abs, depth + 1);
			} else if (entry.isFile()) {
				if (excludeAbs.has(abs)) continue;
				let stat;
				try {
					stat = await fsp.stat(abs);
				} catch {
					continue;
				}
				if (stat.size > SCAN_MAX_FILE_BYTES) continue;
				if (since > 0 && stat.mtimeMs < since) continue;
				found.push({ abs, size: stat.size, mtimeMs: stat.mtimeMs });
			}
		}
	}
	await walk(cwd, 0);
	return found;
}

async function buildArtifacts(sessionId, includeScan) {
	const fold = await readSessionFold(sessionId);
	if (fold === null) return { ok: false, error: "session-not-found" };
	if (fold.mismatch === true) return { ok: false, error: "session-id-mismatch" };
	const cwd = fold.header?.cwd ?? "";
	const createdAt = fold.header?.createdAt ?? 0;
	const items = [];
	const producedAbs = new Set();
	for (const [rawPath, entry] of fold.produced) {
		const abs = path.isAbsolute(rawPath) ? path.normalize(rawPath) : (cwd !== "" ? path.resolve(cwd, rawPath) : rawPath);
		producedAbs.add(abs);
		const stat = await statOrNull(abs);
		const rel = cwd !== "" ? path.relative(cwd, abs) : abs;
		const inside = cwd !== "" ? resolveInside(cwd, abs).ok : false;
		items.push({
			name: path.basename(abs),
			path: abs,
			relPath: rel.startsWith("..") ? abs : rel,
			inside,
			ext: extOf(abs),
			kind: classifyKind(abs),
			size: stat?.size ?? null,
			mtime: stat?.mtimeMs ?? entry.lastTime,
			exists: stat !== null,
			source: "tool",
			ops: entry.ops,
			tools: [...entry.tools],
			changes: entry.count,
			firstTime: entry.firstTime,
			lastTime: entry.lastTime,
			ok: entry.ok
		});
	}
	let scanned = 0;
	if (includeScan && cwd !== "") {
		const scan = await scanWorkspace(cwd, createdAt, producedAbs);
		scanned = scan.length;
		for (const hit of scan) {
			const rel = path.relative(cwd, hit.abs);
			items.push({
				name: path.basename(hit.abs),
				path: hit.abs,
				relPath: rel,
				inside: resolveInside(cwd, hit.abs).ok,
				ext: extOf(hit.abs),
				kind: classifyKind(hit.abs),
				size: hit.size,
				mtime: hit.mtimeMs,
				exists: true,
				source: "scan",
				ops: [],
				tools: [],
				changes: 0,
				firstTime: hit.mtimeMs,
				lastTime: hit.mtimeMs,
				ok: true
			});
		}
	}
	items.sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));
	return {
		ok: true,
		session: {
			id: sessionId,
			title: fold.title,
			cwd,
			createdAt,
			provider: fold.lastContext?.provider ?? null,
			model: fold.lastContext?.model ?? null
		},
		items,
		counts: { produced: items.filter((i) => i.source === "tool").length, scanned, total: items.length }
	};
}

// ── safe preview ─────────────────────────────────────────────────────────────

async function safeResolveForRead(cwd, candidate) {
	const base = resolveInside(cwd, candidate);
	if (!base.ok) return { error: base.reason === "escapes-base" || base.reason === "is-base" ? "forbidden" : "invalid" };
	let realCwd;
	let realAbs;
	try {
		realCwd = await fsp.realpath(cwd);
		realAbs = await fsp.realpath(base.abs);
	} catch {
		return { error: "not-found" };
	}
	// realpath containment defeats symlink escape: a link inside cwd pointing
	// outside resolves outside and is rejected here
	const real = resolveInside(realCwd, realAbs);
	if (!real.ok) return { error: "symlink-escape" };
	const stat = await statOrNull(realAbs);
	if (stat === null || !stat.isFile()) return { error: "not-found" };
	return { abs: realAbs, size: stat.size, mtime: stat.mtimeMs };
}

async function readHead(file, limit) {
	const handle = await fsp.open(file, "r");
	try {
		const buf = Buffer.alloc(limit);
		const { bytesRead } = await handle.read(buf, 0, limit, 0);
		return buf.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
}

async function buildPreview(sessionId, candidate) {
	const fold = await readSessionFold(sessionId);
	if (fold === null) return { ok: false, error: "session-not-found" };
	if (fold.mismatch === true) return { ok: false, error: "session-id-mismatch" };
	const cwd = fold.header?.cwd ?? "";
	if (cwd === "") return { ok: false, error: "session-without-cwd" };
	const safe = await safeResolveForRead(cwd, candidate);
	if (safe.error !== undefined) return { ok: false, error: safe.error };
	const kind = classifyKind(safe.abs);
	const name = path.basename(safe.abs);
	const common = { name, path: safe.abs, size: safe.size, mtime: safe.mtime, kind };
	if (kind === "text") {
		if (safe.size > IMAGE_LIMIT_BYTES) return { ok: true, ...common, kind: "binary" };
		const head = await readHead(safe.abs, TEXT_LIMIT_BYTES + 1);
		const truncated = head.length > TEXT_LIMIT_BYTES;
		return { ok: true, ...common, kind: "text", content: head.subarray(0, TEXT_LIMIT_BYTES).toString("utf8"), truncated };
	}
	if (kind === "image") {
		if (safe.size > IMAGE_LIMIT_BYTES) return { ok: false, error: "too-large" };
		const buf = await fsp.readFile(safe.abs);
		const mime = IMAGE_MIME[extOf(safe.abs)] ?? "application/octet-stream";
		return { ok: true, ...common, kind: "image", mime, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
	}
	return { ok: true, ...common, kind: "binary" };
}

function revealInFileManager(abs) {
	return new Promise((resolve) => {
		const child = spawn("open", ["-R", abs], { stdio: "ignore" });
		child.on("error", () => resolve(false));
		child.on("exit", (code) => resolve(code === 0));
	});
}

// ── side chat (continuable fork child) ───────────────────────────────────────

let ctx = null;
let chatByParent = new Map(); // parentId -> childId (this process)
let parentByChild = new Map(); // childId -> parentId
let childAccum = new Map(); // childId -> { running, partial }
let parentResume = new Map(); // parentId -> Promise<Agent>
let sseClients = new Map(); // parentId -> Set<ServerResponse>

function agentsService() {
	try {
		return ctx?.get("agents") ?? undefined;
	} catch {
		return undefined;
	}
}

function subagentsService() {
	try {
		return ctx?.get("subagents") ?? undefined;
	} catch {
		return undefined;
	}
}

async function ensureParentAgent(sessionId) {
	const agents = agentsService();
	if (agents === undefined) throw new Error("agents service unavailable");
	const existing = agents.get(sessionId);
	if (existing !== undefined) return existing;
	let pending = parentResume.get(sessionId);
	if (pending === undefined) {
		pending = (async () => {
			const fold = await readSessionFold(sessionId);
			if (fold === null) throw new Error("session-not-found");
			const options = { resumeSessionId: sessionId };
			if (fold.lastContext !== null && fold.lastContext.provider !== "") {
				options.agentOptions = { provider: fold.lastContext.provider, model: fold.lastContext.model };
			}
			const { agent } = await agents.resume(options);
			return agent;
		})();
		parentResume.set(sessionId, pending);
		pending.catch(() => parentResume.delete(sessionId));
		pending.finally(() => {
			if (parentResume.get(sessionId) === pending) parentResume.delete(sessionId);
		});
	}
	try {
		return await pending;
	} catch (error) {
		const live = agents.get(sessionId);
		if (live !== undefined) return live; // lost a resume race to the web UI
		throw error;
	}
}

async function findSideChildren(parentId) {
	const subagents = subagentsService();
	if (subagents === undefined || typeof subagents.listChildren !== "function") return [];
	try {
		const children = await subagents.listChildren(parentId, AbortSignal.timeout(15000));
		const ids = [];
		for (const entry of children) {
			if (entry?.kind !== "child") continue;
			if (entry.mode !== "continuable" || entry.label !== CHAT_LABEL) continue;
			ids.push(entry.id); // entries are createdAt-ordered; the LAST one is the newest
		}
		return ids;
	} catch {
		return [];
	}
}

async function findSideChild(parentId) {
	const cached = chatByParent.get(parentId);
	if (cached !== undefined) return cached;
	const ids = await findSideChildren(parentId);
	if (ids.length === 0) return null;
	const newest = ids[ids.length - 1];
	chatByParent.set(parentId, newest);
	parentByChild.set(newest, parentId);
	return newest;
}

function childOptionsFor(agent, sessionId) {
	// inherit the live agent's model when available, else the log's last context
	const options = {};
	if (agent?.options && typeof agent.options.provider === "string" && agent.options.provider !== "") {
		options.provider = agent.options.provider;
		if (typeof agent.options.model === "string" && agent.options.model !== "") options.model = agent.options.model;
		return options;
	}
	return options; // empty = harness default selection
}

// model picker ids may arrive as "provider/model" group ids (e.g. the main
// UI's "openrouter/free" router id) or bare model ids ("deepseek-v4-flash")
function parseModelId(raw) {
	const s = String(raw ?? "").trim();
	if (s === "") return null;
	const slash = s.indexOf("/");
	if (slash > 0 && slash < s.length - 1) {
		return { provider: s.slice(0, slash), model: s.slice(slash + 1) };
	}
	return { provider: null, model: s };
}

// the routing a side-chat child actually runs with: its own log's latest
// request/context (created after the fork seed), else the parent's context
async function currentChildRouting(childId) {
	const childFold = await readSessionFold(childId);
	const seed = childFold?.header?.seedLength ?? 0;
	if (childFold !== null && childFold.lastContext !== null && (childFold.lastContext.seq ?? Infinity) >= seed) {
		return { provider: childFold.lastContext.provider ?? null, model: childFold.lastContext.model ?? null };
	}
	return null; // unknown: never spuriously rotate the child
}

// model catalog: same source as the main chat's picker (the harness llm
// service); falls back to a minimal list derived from the parent's routing
async function buildModelCatalog() {
	const llm = ctx !== null && ctx !== undefined ? (function () { try { return ctx.get("llm"); } catch { return undefined; } })() : undefined;
	const groups = [];
	if (llm !== undefined && llm !== null && typeof llm.listProviders === "function" && typeof llm.listModels === "function") {
		const providers = await llm.listProviders();
		for (const p of providers) {
			try {
				const models = await llm.listModels(p.id);
				const items = (Array.isArray(models) ? models : []).map((m) => ({
					id: (p.id ?? "") + "/" + (m?.id ?? m ?? ""),
					model: String(m?.id ?? m ?? ""),
					label: String(m?.name ?? m?.id ?? m ?? ""),
					provider: p.id ?? null
				}));
				if (items.length > 0) groups.push({ id: p.id ?? "", name: p.name ?? p.id ?? "", models: items });
			} catch (error) {
				groups.push({ id: p.id ?? "", name: p.name ?? p.id ?? "", models: [], failure: error instanceof Error ? error.message : String(error) });
			}
		}
	}
	return { ok: true, groups };
}

async function chatSend(parentId, text, model) {
	const subagents = subagentsService();
	if (subagents === undefined || typeof subagents.startContinuable !== "function") {
		return { ok: false, error: "subagents service unavailable in this profile" };
	}
	if (typeof text !== "string" || text.trim() === "") return { ok: false, error: "text required" };
	if (text.length > CHAT_TEXT_LIMIT) return { ok: false, error: "text too long" };
	let agent;
	try {
		agent = await ensureParentAgent(parentId);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
	const prompt = [{ type: "text", text }];
	let childId = await findSideChild(parentId);
	const signal = AbortSignal.timeout(120000);
	try {
		if (childId !== null) {
			// followup cannot change the model (harness fixes the child's routing
			// at creation; SubagentFollowupOptions = {source, signal} only). A
			// model switch therefore starts a NEW fork child below.
			if (typeof model === "string" && model.trim() !== "") {
				const routing = parseModelId(model);
				const current = await currentChildRouting(childId);
				if (routing !== null && (current === null || routing.model !== current.model || (routing.provider ?? "") !== (current.provider ?? ""))) {
					// different routing → start a fresh fork child; the old one
					// stays in its own log and is merged back on replay
					childId = null;
				}
			}
		}
		if (childId !== null) {
			await subagents.followup(agent, childId, prompt, { source: { kind: "user" }, signal });
		} else {
			const request = {
				prompt,
				parent: agent,
				// keep the side chat a chat: answer directly, touch tools only on explicit request
				persona: "You are the side-chat assistant for this session's right panel. Answer directly and concisely in the user's language. Do NOT run tools, do NOT start subtasks, and do NOT modify files unless the user explicitly asks for an action."
			};
			const inherited = childOptionsFor(agent, parentId);
			// explicit user model pick wins over the inherited routing
			if (typeof model === "string" && model.trim() !== "") {
				const routing = parseModelId(model);
				if (routing !== null) {
					request.agentOptions = {};
					if (routing.provider !== null) request.agentOptions.provider = routing.provider;
					if (routing.model !== null) request.agentOptions.model = routing.model;
				} else {
					// non-grouped id: keep the parent's provider, override the model only
					request.agentOptions = { model: model.trim() };
				}
			} else if (inherited.provider !== undefined) {
				request.agentOptions = inherited;
			}
			const started = await subagents.startContinuable({ provider: "fork", label: CHAT_LABEL, request, signal });
			childId = started.childId;
			chatByParent.set(parentId, childId);
			parentByChild.set(childId, parentId);
			// the previous child (if any) stays intact in its own session log;
			// findSideChild now resolves to the newest continuable child
		}
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
	if (!childAccum.has(childId)) childAccum.set(childId, { running: true, partial: "" });
	broadcast(parentId, { type: "chat/accepted", childId, model: model ?? null });
	return { ok: true, childId, model: model ?? null };
}

async function chatStop(parentId) {
	const subagents = subagentsService();
	if (subagents === undefined || typeof subagents.interrupt !== "function") return { ok: false, error: "subagents service unavailable in this profile" };
	// model switches rotate children: interrupt every side-chat child that is
	// still running so no rotated-away child keeps burning tokens in the dark
	const ids = await findSideChildren(parentId);
	const agents = agentsService();
	let stopped = 0;
	for (const childId of ids) {
		let running = false;
		if (agents !== undefined) {
			try {
				running = agents.get(childId)?.status === "running";
			} catch {
				running = false;
			}
		}
		if (!running && childAccum.get(childId)?.running !== true) continue;
		try {
			subagents.interrupt(childId, { kind: "user", parentSessionId: parentId });
			stopped += 1;
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}
	if (stopped === 0) return { ok: true, stopped: false };
	broadcast(parentId, { type: "chat/stopping" });
	return { ok: true, stopped: true };
}

async function chatState(parentId) {
	// every side-chat child this process knows about + historic ones from the
	// parent's own log (model switches create a new fork child per routing)
	const childIds = await findSideChildren(parentId);
	let childId = childIds.length > 0 ? childIds[childIds.length - 1] : await findSideChild(parentId);
	if (childId === null) {
		return { ok: true, childId: null, messages: [], running: false, provider: null, model: null };
	}
	// replay in child creation order so a model-switched conversation keeps
	// its earlier exchanges (older children first, active child last)
	const known = [];
	for (const id of childIds) {
		if (!known.includes(id)) known.push(id);
	}
	if (childId !== null && !known.includes(childId)) known.push(childId);
	const ownByChild = [];
	let lastFold = null;
	for (const id of known) {
		const fold = await readSessionFold(id);
		if (fold === null) continue;
		const own = fold.messages.slice(fold.ownStart ?? 0);
		ownByChild.push({ childId: id, messages: own, fold });
		lastFold = fold;
	}
	const messages = ownByChild.flatMap(({ childId: cid, messages: own }) => own.map(({ role, text, time, interrupted }) => {
		const base = interrupted === true ? { role, text, time, interrupted } : { role, text, time };
		return ownByChild.length > 1 ? Object.assign(base, { childId: cid }) : base;
	}));
	let running = false;
	const agents = agentsService();
	if (agents !== undefined) {
		try {
			running = agents.get(childId)?.status === "running";
		} catch {
			running = false;
		}
	}
	const parentFold = await readSessionFold(parentId);
	return {
		ok: true,
		childId,
		messages,
		running,
		partial: childAccum.get(childId)?.partial ?? "",
		provider: lastFold?.lastContext?.provider ?? parentFold?.lastContext?.provider ?? null,
		model: lastFold?.lastContext?.model ?? parentFold?.lastContext?.model ?? null,
		childModel: lastFold?.lastContext?.model ?? null
	};
}

// ── SSE plumbing ─────────────────────────────────────────────────────────────

function broadcast(parentId, payload) {
	const set = sseClients.get(parentId);
	if (set === undefined || set.size === 0) return;
	const frame = `data: ${JSON.stringify(payload)}\n\n`;
	for (const res of set) {
		try {
			res.write(frame);
		} catch {
			set.delete(res);
		}
	}
}

function sessionEventToChatFrames(childId, event) {
	const type = event?.type;
	const data = event?.data;
	if (type === "assistant/chunk") {
		const chunk = data?.chunk;
		if (chunk?.type !== "text-delta" || chunk.text === "") return null;
		return { type: "delta", text: chunk.text };
	}
	if (type === "assistant/message") {
		const text = textBlocksOf(data?.message?.content);
		return { type: "assistant", text, interrupted: data?.interrupted === true };
	}
	if (type === "user/message" && (data?.source?.kind === "user" || data?.source?.kind === "coordinator")) {
		const text = firstTextOf(data?.content);
		if (text === "") return null;
		return { type: "user", text };
	}
	if (type === "turn/start") return { type: "turn", state: "start" };
	if (type === "turn/end") return { type: "turn", state: "end", reason: data?.reason?.kind ?? null };
	return null;
}

function onSessionEvent(session, event) {
	const sid = session?.id ?? session?.header?.id;
	if (typeof sid !== "string") return;
	const parentId = parentByChild.get(sid);
	if (parentId === undefined) return;
	const acc = childAccum.get(sid);
	if (event?.type === "turn/start") {
		if (acc !== undefined) {
			acc.running = true;
			acc.partial = "";
		}
	}
	if (event?.type === "turn/end" && acc !== undefined) {
		acc.running = false;
		acc.partial = "";
	}
	if (event?.type === "assistant/chunk" && data0(event)?.chunk?.type === "text-delta" && acc !== undefined) {
		acc.partial += event.data.chunk.text;
	}
	const frame = sessionEventToChatFrames(sid, event);
	if (frame !== null) broadcast(parentId, frame);
}

function data0(event) {
	return event?.data;
}

function attachSse(parentId, req, res) {
	res.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache, no-transform",
		connection: "keep-alive",
		"x-accel-buffering": "no"
	});
	let set = sseClients.get(parentId);
	if (set === undefined) {
		set = new Set();
		sseClients.set(parentId, set);
	}
	set.add(res);
	const heartbeat = setInterval(() => {
		try {
			res.write(": ping\n\n");
		} catch {
			// dropped connection: cleaned below
		}
	}, 15000);
	const drop = () => {
		clearInterval(heartbeat);
		set.delete(res);
		if (set.size === 0) sseClients.delete(parentId);
	};
	req.on("close", drop);
	res.on("close", drop);
	// initial snapshot so a fresh subscriber learns the child + running state
	chatState(parentId)
		.then((state) => {
			if (!res.writableEnded) {
				res.write(`data: ${JSON.stringify({ type: "hello", childId: state.childId, running: state.running, partial: state.partial })}\n\n`);
			}
		})
		.catch(() => {});
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

function sendJson(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(body);
}

async function readJsonBody(req) {
	const chunks = [];
	let total = 0;
	await new Promise((resolve, reject) => {
		req.on("data", (chunk) => {
			total += chunk.length;
			if (total > 256 * 1024) {
				reject(new Error("too-large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", resolve);
		req.on("error", reject);
	});
	if (chunks.length === 0) return {};
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return parsed !== null && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

// Modern browsers state their site on every request; cross-site simple POSTs
// (CSRF-style drives from other pages) carry a foreign value and are refused.
function sameOriginOk(req) {
	const site = req.headers["sec-fetch-site"];
	if (site === undefined) return true; // non-browser clients on localhost
	return site === "same-origin" || site === "same-site" || site === "none";
}

const SESSION_ID_RE = /^[\w.-]{1,120}$/;

// ── plugin entry ─────────────────────────────────────────────────────────────

export function apply(pluginCtx) {
	if (pluginCtx.webServer === undefined) {
		pluginCtx.logger?.warn?.("dsh-sidepanel: webServer unavailable; /sidepanel routes not registered");
		return;
	}
	ctx = pluginCtx;
	const disposers = [];

	let routeDispose = null;
	try {
		routeDispose = pluginCtx.webServer.register({
			kind: "prefix",
			path: "/sidepanel",
			handler: async (req, res) => {
			const url = new URL(req.url ?? "/", "http://x");
			const pathname = url.pathname;
			const query = url.searchParams;
			try {
				if (req.method === "GET" && pathname === "/sidepanel/health") {
					sendJson(res, 200, {
						ok: true,
						addon: "dsh-sidepanel",
						version: VERSION,
						chat: agentsService() !== undefined && subagentsService() !== undefined
					});
					return;
				}
				if (req.method === "GET" && pathname === "/sidepanel/artifacts") {
					const sessionId = query.get("sessionId") ?? "";
					if (!SESSION_ID_RE.test(sessionId)) {
						sendJson(res, 400, { ok: false, error: "invalid sessionId" });
						return;
					}
					sendJson(res, 200, await buildArtifacts(sessionId, query.get("scan") === "1"));
					return;
				}
				if (req.method === "GET" && pathname === "/sidepanel/file") {
					const sessionId = query.get("sessionId") ?? "";
					const target = query.get("path") ?? "";
					if (!SESSION_ID_RE.test(sessionId) || target === "") {
						sendJson(res, 400, { ok: false, error: "invalid parameters" });
						return;
					}
					sendJson(res, 200, await buildPreview(sessionId, target));
					return;
				}
				if (req.method === "POST" && pathname === "/sidepanel/reveal") {
					if (!sameOriginOk(req)) {
						sendJson(res, 403, { ok: false, error: "cross-site refused" });
						return;
					}
					const body = await readJsonBody(req);
					if (!SESSION_ID_RE.test(String(body.sessionId ?? ""))) {
						sendJson(res, 400, { ok: false, error: "invalid sessionId" });
						return;
					}
					const fold = await readSessionFold(String(body.sessionId));
					const cwd = fold?.header?.cwd ?? "";
					if (cwd === "") {
						sendJson(res, 404, { ok: false, error: "session-not-found" });
						return;
					}
					const safe = await safeResolveForRead(cwd, String(body.path ?? ""));
					if (safe.error !== undefined) {
						sendJson(res, safe.error === "not-found" ? 404 : 403, { ok: false, error: safe.error });
						return;
					}
					const opened = await revealInFileManager(safe.abs);
					sendJson(res, opened ? 200 : 500, { ok: opened, path: safe.abs });
					return;
				}
				if (req.method === "GET" && pathname === "/sidepanel/chat/state") {
					const sessionId = query.get("sessionId") ?? "";
					if (!SESSION_ID_RE.test(sessionId)) {
						sendJson(res, 400, { ok: false, error: "invalid sessionId" });
						return;
					}
					sendJson(res, 200, await chatState(sessionId));
					return;
				}
				if (req.method === "POST" && pathname === "/sidepanel/chat/send") {
					if (!sameOriginOk(req)) {
						sendJson(res, 403, { ok: false, error: "cross-site refused" });
						return;
					}
					const body = await readJsonBody(req);
					if (!SESSION_ID_RE.test(String(body.sessionId ?? ""))) {
						sendJson(res, 400, { ok: false, error: "invalid sessionId" });
						return;
					}
					sendJson(res, 200, await chatSend(String(body.sessionId), String(body.text ?? ""), typeof body.model === "string" ? body.model : undefined));
					return;
				}
				if (req.method === "GET" && pathname === "/sidepanel/chat/models") {
					sendJson(res, 200, await buildModelCatalog());
					return;
				}
				if (req.method === "POST" && pathname === "/sidepanel/chat/stop") {
					if (!sameOriginOk(req)) {
						sendJson(res, 403, { ok: false, error: "cross-site refused" });
						return;
					}
					const body = await readJsonBody(req);
					if (!SESSION_ID_RE.test(String(body.sessionId ?? ""))) {
						sendJson(res, 400, { ok: false, error: "invalid sessionId" });
						return;
					}
					sendJson(res, 200, await chatStop(String(body.sessionId)));
					return;
				}
				if (req.method === "GET" && pathname === "/sidepanel/chat/stream") {
					const sessionId = query.get("sessionId") ?? "";
					if (!SESSION_ID_RE.test(sessionId)) {
						sendJson(res, 400, { ok: false, error: "invalid sessionId" });
						return;
					}
					attachSse(sessionId, req, res);
					return;
				}
				sendJson(res, 404, { ok: false, error: "not-found" });
			} catch (error) {
				const status = error?.statusCode ?? 500;
				sendJson(res, status, { ok: false, error: error instanceof Error ? error.message : String(error) });
			}
		}
		});
		disposers.push(routeDispose);
	} catch (error) {
		pluginCtx.logger?.warn?.("dsh-sidepanel: webServer.register failed: " + (error instanceof Error ? error.message : String(error)));
	}

	if (typeof pluginCtx.on === "function") {
		const off = pluginCtx.on("session/event", onSessionEvent);
		if (typeof off === "function") disposers.push(off);
	}

	// cordis effects run the callback immediately and use its return value as
	// the disposer — return a teardown function, do not run it here
	pluginCtx.effect(() => () => {
		for (const dispose of disposers) {
			try {
				dispose();
			} catch {
				// teardown best effort
			}
		}
		sseClients = new Map();
		childAccum = new Map();
		chatByParent = new Map();
		parentByChild = new Map();
	}, "dsh-sidepanel: /sidepanel routes");
	pluginCtx.logger?.info?.("dsh-sidepanel: /sidepanel routes registered");
}
