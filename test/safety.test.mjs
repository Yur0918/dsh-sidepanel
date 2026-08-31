// Filesystem-level tests: artifact building over a synthetic session log and
// the preview path-safety chain (containment, symlink escape, missing files).
import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _pure } from "../lib/index.js";

const { buildArtifacts, buildPreview, resolveInside } = _pure;

let root;
let dshHome;
let ws;
let outside;
const SID = "session-test-0001";

function writeLog(lines) {
	fs.mkdirSync(path.join(dshHome, "sessions", "project-x", SID), { recursive: true });
	fs.writeFileSync(path.join(dshHome, "sessions", "project-x", SID, "session.jsonl"), lines.join("\n") + "\n");
}

function call(name, callId, args, ok = true, time = 1700000000000) {
	return [
		JSON.stringify({ type: "tool/call", time, data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) } }),
		JSON.stringify({ type: "tool/result", time, data: { message: { id: "r" + callId, role: "user", content: [{ type: "tool-result", toolCallId: callId, content: "done", isError: !ok }], source: { kind: "tool", callId } } } })
	];
}

test.before(async () => {
	root = await fsp.mkdtemp(path.join(os.tmpdir(), "dsh-sidepanel-test-"));
	dshHome = path.join(root, "home");
	ws = path.join(root, "ws");
	outside = path.join(root, "outside");
	await fsp.mkdir(path.join(ws, "src", "deep"), { recursive: true });
	await fsp.mkdir(outside, { recursive: true });
	process.env.DSH_HOME = dshHome;
});

test.after(async () => {
	delete process.env.DSH_HOME;
	await fsp.rm(root, { recursive: true, force: true });
});

test("buildArtifacts attributes tool-produced files and flags deleted ones", async () => {
	await fsp.writeFile(path.join(ws, "made.md"), "# hi\n");
	await fsp.writeFile(path.join(ws, "src", "code.ts"), "export {}\n");
	writeLog([
		JSON.stringify({ type: "session", id: SID, cwd: ws, createdAt: Date.now() - 1000 }),
		...call("write", "c1", { file_path: path.join(ws, "made.md"), content: "x" }),
		...call("edit", "c2", { file_path: path.join(ws, "src", "code.ts"), old_string: "a", new_string: "b" }),
		...call("write", "c3", { file_path: path.join(ws, "ghost.txt"), content: "x" }, false)
	]);
	const res = await buildArtifacts(SID, false);
	assert.equal(res.ok, true);
	assert.equal(res.counts.produced, 3);
	assert.equal(res.counts.scanned, 0);
	const byPath = new Map(res.items.map((i) => [i.path, i]));
	assert.equal(byPath.get(path.join(ws, "made.md")).exists, true);
	assert.equal(byPath.get(path.join(ws, "made.md")).kind, "text");
	assert.equal(byPath.get(path.join(ws, "src", "code.ts")).relPath, path.join("src", "code.ts"));
	const ghost = byPath.get(path.join(ws, "ghost.txt"));
	assert.equal(ghost.exists, false, "failed write leaves no file → flagged");
	assert.equal(ghost.ok, false);
	assert.ok(res.items[0].lastTime >= res.items[res.items.length - 1].lastTime, "sorted by recency");
});

test("buildArtifacts scan picks up workspace changes but skips heavy dirs", async () => {
	await fsp.writeFile(path.join(ws, "bash-made.log"), "hello\n");
	await fsp.mkdir(path.join(ws, "node_modules", "pkg"), { recursive: true });
	await fsp.writeFile(path.join(ws, "node_modules", "pkg", "nope.js"), "x");
	writeLog([
		JSON.stringify({ type: "session", id: SID, cwd: ws, createdAt: Date.now() - 1000 }),
		...call("write", "c1", { file_path: path.join(ws, "made.md"), content: "x" })
	]);
	const res = await buildArtifacts(SID, true);
	assert.equal(res.ok, true);
	const paths = res.items.map((i) => i.path);
	assert.ok(paths.includes(path.join(ws, "bash-made.log")), "scan source covers bash-created files");
	assert.equal(paths.some((p) => p.includes("node_modules")), false, "node_modules skipped");
	const scanned = res.items.find((i) => i.source === "scan");
	assert.ok(scanned, "scan items are labelled");
	assert.equal(res.items.find((i) => i.source === "tool").source, "tool");
});

test("buildPreview serves text and images with size caps", async () => {
	await fsp.writeFile(path.join(ws, "doc.txt"), "plain text");
	const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
	await fsp.writeFile(path.join(ws, "pix.png"), png);
	writeLog([JSON.stringify({ type: "session", id: SID, cwd: ws, createdAt: 1 })]);
	const text = await buildPreview(SID, "doc.txt");
	assert.equal(text.ok, true);
	assert.equal(text.kind, "text");
	assert.equal(text.content, "plain text");
	const img = await buildPreview(SID, "pix.png");
	assert.equal(img.ok, true);
	assert.equal(img.kind, "image");
	assert.equal(img.mime, "image/png");
	assert.ok(img.dataUrl.startsWith("data:image/png;base64,"));
});

test("buildPreview refuses traversal, symlink escape and outside absolutes", async () => {
	await fsp.writeFile(path.join(outside, "secret.txt"), "secret");
	await fsp.symlink(path.join(outside, "secret.txt"), path.join(ws, "sneaky.txt"));
	writeLog([JSON.stringify({ type: "session", id: SID, cwd: ws, createdAt: 1 })]);

	const trav = await buildPreview(SID, "../outside/secret.txt");
	assert.equal(trav.ok, false);
	assert.equal(trav.error, "forbidden");

	const abs = await buildPreview(SID, path.join(outside, "secret.txt"));
	assert.equal(abs.ok, false);
	assert.equal(abs.error, "forbidden");

	const link = await buildPreview(SID, "sneaky.txt");
	assert.equal(link.ok, false, "symlink inside cwd pointing outside must be rejected");
	assert.equal(link.error, "symlink-escape");

	const missing = await buildPreview(SID, "nope.txt");
	assert.equal(missing.ok, false);
	assert.equal(missing.error, "not-found");
});

test("buildPreview refuses sessions whose log id does not match the directory", async () => {
	const other = "session-test-9999";
	fs.mkdirSync(path.join(dshHome, "sessions", "project-x", other), { recursive: true });
	fs.writeFileSync(path.join(dshHome, "sessions", "project-x", other, "session.jsonl"),
		JSON.stringify({ type: "session", id: "session-something-else", cwd: ws, createdAt: 1 }) + "\n");
	const res = await buildPreview(other, "doc.txt");
	assert.equal(res.ok, false);
	assert.equal(res.error, "session-id-mismatch");
});
