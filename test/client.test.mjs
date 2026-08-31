// Client-half pure logic tests: the module is loaded through a stubbed
// window.__ModuleLoader__ with a minimal fake react, then the _pure export is
// exercised (persistence sanitization, grid-track math, artifact filtering,
// and the chat state machine). Also asserts the slot registrations are the
// expected ones (idempotent ids).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import url from "node:url";

const file = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "lib", "client.js");
const source = fs.readFileSync(file, "utf8");

const fakeReact = {
	createElement: (type, props, ...children) => ({ type, props, children }),
	Fragment: "Fragment",
	useState: (v) => [typeof v === "function" ? v() : v, () => {}],
	useEffect: () => {},
	useRef: () => ({ current: null }),
	useCallback: (fn) => fn
};
let captured = null;
const sandboxWindow = {
	__ModuleLoader__: {
		load(entry) { captured = entry; }
	},
	navigator: { language: "en-US" }
};
const context = vm.createContext({ window: sandboxWindow, navigator: sandboxWindow.navigator, console });
vm.runInContext(source, context, { filename: "client.js" });
assert.ok(captured !== null, "module registered with __ModuleLoader__");
const exports = captured.factory((id) => {
	if (id === "react") return fakeReact;
	throw new Error("unexpected require: " + id);
});
const P = exports._pure;

const J = JSON.stringify; // vm-realm objects fail strict deepEqual; compare serialized

test("slot registrations use stable, idempotent ids", () => {
	assert.equal(J(exports.inject), J(["slots"]));
	const registered = [];
	const fakeSlots = {
		inject(name, fn) { fn(); },
		register(meta) { registered.push(meta); }
	};
	const effects = [];
	// cordis effects run immediately; the fake mirrors that so slots.inject fires
	const fakeCtx = {
		get: (k) => (k === "slots" ? fakeSlots : undefined),
		effect: (fn) => { fn(); effects.push(fn); return () => {}; }
	};
	exports.apply(fakeCtx);
	assert.deepEqual(registered.map((r) => r.name + ":" + r.id).sort(), [
		"conversation.session.header.utilities:sidepanel-toggle",
		"shell.overlay:sidepanel-panel"
	]);
	// applying twice must not throw and must re-register the same ids (HMR-safe)
	exports.apply(fakeCtx);
	assert.equal(registered.length, 4);
});

test("sanitizeState clamps width and normalizes tabs and flags", () => {
	assert.equal(J(P.sanitizeState({ open: true, width: 99999, tab: "chat", includeScan: 1 })), J({ open: true, width: P.PANEL_MAX, tab: "chat", includeScan: false, chatModel: null }), "only strict true enables scan");
	assert.equal(J(P.sanitizeState({ open: 1, width: 10 })), J({ open: false, width: P.PANEL_MIN, tab: "art", includeScan: false, chatModel: null }));
	assert.equal(J(P.sanitizeState(null)), J({ open: false, width: 380, tab: "art", includeScan: false, chatModel: null }));
	assert.equal(P.clampPanelWidth("abc"), 380);
	assert.equal(P.clampPanelWidth(300), 300);
	assert.equal(P.clampPanelWidth(1000), P.PANEL_MAX);
});

test("loadPersistedState survives broken storage and corrupt JSON", () => {
	assert.equal(J(P.loadPersistedState({ getItem: () => null })), J({ open: false, width: 380, tab: "art", includeScan: false, chatModel: null }));
	assert.equal(J(P.loadPersistedState({ getItem: () => "{broken" })), J({ open: false, width: 380, tab: "art", includeScan: false, chatModel: null }));
	assert.equal(
		J(P.loadPersistedState({ getItem: () => JSON.stringify({ open: true, width: 420, tab: "chat" }) })),
		J({ open: true, width: 420, tab: "chat", includeScan: false, chatModel: null })
	);
	assert.equal(P.loadPersistedState({ getItem: () => { throw new Error("blocked"); } }).open, false);
});

test("computeTrack docks when center can keep its floor, overlays otherwise", () => {
	const grid = "280px minmax(0, 1fr) 0px";
	// 1500 total: 280 sidebar + 640 floor → 580 available → full 380 dock
	assert.equal(J(P.computeTrack(1500, grid, 380)), J({ track: 380, mode: "dock" }));
	// 1100 total: 180 available → below PANEL_MIN → overlay
	assert.equal(J(P.computeTrack(1100, grid, 380)), J({ track: 0, mode: "overlay" }));
	// 1000 total: 80 available → overlay
	assert.equal(P.computeTrack(1000, grid, 380).mode, "overlay");
	// unexpected template → overlay, never a broken grid
	assert.equal(J(P.computeTrack(1500, "weird", 380)), J({ track: 0, mode: "overlay" }));
	// closed panel never touches the grid
	assert.equal(J(P.computeTrack(1500, grid, 0)), J({ track: 0, mode: "closed" }));
	// details open (360) shrinks the available track
	const gridDetails = "280px minmax(0, 1fr) 360px";
	assert.equal(J(P.computeTrack(1600, gridDetails, 380)), J({ track: 320, mode: "dock" }));
});

test("filterArtifacts matches name/path/ext/kind and source", () => {
	const items = [
		{ name: "a.md", relPath: "docs/a.md", ext: "md", kind: "text", source: "tool" },
		{ name: "b.ts", relPath: "src/b.ts", ext: "ts", kind: "text", source: "scan" },
		{ name: "c.png", relPath: "img/c.png", ext: "png", kind: "image", source: "tool" }
	];
	assert.equal(P.filterArtifacts(items, "", "all").length, 3);
	assert.equal(P.filterArtifacts(items, "png", "all").length, 1);
	assert.equal(P.filterArtifacts(items, "SRC/", "all").length, 1);
	assert.equal(P.filterArtifacts(items, "md", "all").length, 1);
	assert.equal(P.filterArtifacts(items, "", "tool").length, 2);
	assert.equal(P.filterArtifacts(items, "", "scan").length, 1);
	assert.equal(P.filterArtifacts(null, "x", "all").length, 0);
});

test("chat reducer walks the full streaming lifecycle", () => {
	let s = P.chatInitial();
	assert.equal(s.phase, "idle");
	s = P.chatReducer(s, { type: "send", text: "hi" });
	assert.equal(s.phase, "streaming");
	assert.equal(s.messages.length, 1);
	s = P.chatReducer(s, { type: "delta", text: "Hel" });
	s = P.chatReducer(s, { type: "delta", text: "lo" });
	assert.equal(s.partial, "Hello");
	s = P.chatReducer(s, { type: "turn-start" });
	assert.equal(s.phase, "streaming");
	s = P.chatReducer(s, { type: "assistant", text: "Hello!" });
	assert.equal(s.partial, "");
	assert.equal(s.messages[1].role, "assistant");
	s = P.chatReducer(s, { type: "turn-end", reason: "completed" });
	assert.equal(s.phase, "idle");
	assert.equal(s.messages.length, 2);
});

test("chat reducer handles stop, orphan partials and errors", () => {
	let s = P.chatInitial();
	s = P.chatReducer(s, { type: "send", text: "q" });
	s = P.chatReducer(s, { type: "delta", text: "partial answer" });
	s = P.chatReducer(s, { type: "stop-requested" });
	assert.equal(s.phase, "stopping");
	// deltas keep appending while stopping (in-flight flush)
	s = P.chatReducer(s, { type: "delta", text: "!" });
	assert.equal(s.partial, "partial answer!");
	// turn interrupted without a final assistant/message row
	s = P.chatReducer(s, { type: "turn-end", reason: "interrupted" });
	assert.equal(s.phase, "idle");
	assert.equal(s.messages.length, 2, "orphan partial becomes an interrupted assistant bubble");
	assert.equal(s.messages[1].interrupted, true);

	s = P.chatReducer(s, { type: "send", text: "again" });
	s = P.chatReducer(s, { type: "error", error: "boom" });
	assert.equal(s.phase, "error");
	assert.equal(s.error, "boom");
	assert.equal(s.messages[s.messages.length - 1].role, "user", "error keeps the user turn for retry");
});

test("chat reducer retry drops the failed exchange and restore resets cleanly", () => {
	let s = P.chatInitial();
	s = P.chatReducer(s, { type: "send", text: "one" });
	s = P.chatReducer(s, { type: "assistant", text: "1" });
	s = P.chatReducer(s, { type: "send", text: "two" });
	s = P.chatReducer(s, { type: "error", error: "x" });
	s = P.chatReducer(s, { type: "retry" });
	assert.equal(s.messages.length, 2, "keeps the first exchange, drops the failed one");
	assert.equal(s.lastUser, "two", "lastUser survives for the resend");
	assert.equal(s.phase, "idle");

	s = P.chatReducer(s, { type: "restore", messages: [{ role: "assistant", text: "replayed" }], running: true, partial: "str" });
	assert.equal(s.phase, "streaming");
	assert.equal(s.partial, "str");
	assert.deepEqual(s.messages, [{ role: "assistant", text: "replayed" }]);
});

test("sanitizeState keeps a non-empty chatModel and drops junk", () => {
	assert.equal(P.sanitizeState({ chatModel: "openrouter/free" }).chatModel, "openrouter/free");
	assert.equal(P.sanitizeState({ chatModel: "  " }).chatModel, null);
	assert.equal(P.sanitizeState({ chatModel: 42 }).chatModel, null);
	assert.equal(P.sanitizeState({ chatModel: "x" }).chatModel, "x");
});

test("stickModeFor pauses on manual scroll-up and follows at the bottom", () => {
	// at the bottom: follow
	assert.equal(P.stickModeFor({ distanceFromBottom: 0 }), "follow");
	assert.equal(P.stickModeFor({ distanceFromBottom: 47 }), "follow");
	// scrolled up: pause
	assert.equal(P.stickModeFor({ distanceFromBottom: 49 }), "pause");
	assert.equal(P.stickModeFor({ distanceFromBottom: 5000 }), "pause");
	// explicit user pin always follows
	assert.equal(P.stickModeFor({ distanceFromBottom: 5000, userPinned: true }), "follow");
});

test("normalizeModelList flattens groups, arrays and catalog shapes", () => {
	// llm catalog groups shape
	const groups = { groups: [
		{ id: "openrouter", name: "openrouter", models: [{ id: "openrouter/free", name: "Free Models Router" }, { id: "openrouter/m2", name: "M2" }] },
		{ id: "deepseek-official", models: [{ id: "v4" }] },
		{ id: "broken", models: [], failure: "offline" }
	]};
	const flat = P.normalizeModelList(groups);
	assert.equal(flat.length, 3);
	assert.equal(flat[0].id, "openrouter/free", "already-flat host ids stay untouched");
	assert.equal(flat[0].label, "Free Models Router");
	assert.equal(flat[0].provider, "openrouter");
	assert.equal(flat[1].id, "openrouter/m2");
	assert.equal(flat[2].id, "deepseek-official/v4", "bare group-local ids get prefixed once");
	assert.equal(flat[2].label, "v4", "groups branch fills label from m.name/m.id");
	// plain array of strings / objects
	assert.equal(P.normalizeModelList(["a", "b"]).length, 2);
	assert.equal(P.normalizeModelList([{ model: "m", name: "M" }])[0].id, "m");
	// dedup + junk
	assert.equal(P.normalizeModelList(["a", "a", null, "", { id: "a" }]).length, 1);
	assert.equal(P.normalizeModelList({ models: [{ id: "x" }] })[0].id, "x");
	assert.equal(P.normalizeModelList(null).length, 0);
});

test("pickStoredModel prefers session pick over global and supports clearing", () => {
	assert.equal(J(P.pickStoredModel("openrouter/free", "zai/GLM-5.3")), J({ global: "openrouter/free", session: "zai/GLM-5.3", effective: "zai/GLM-5.3" }));
	assert.equal(P.pickStoredModel("openrouter/free", null).effective, "openrouter/free");
	assert.equal(P.pickStoredModel(null, null).effective, null);
	assert.equal(P.pickStoredModel("", "  ").effective, null);
});
