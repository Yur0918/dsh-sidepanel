// Unit tests for the dsh-sidepanel host half: session-log folding (artifact
// attribution), path-containment math, and kind classification.
import test from "node:test";
import assert from "node:assert/strict";
import { _pure } from "../lib/index.js";
import { zstdCompressSync } from "node:zlib";

const { foldSessionLog, resolveInside, classifyKind, decodeZstdLog } = _pure;

function line(type, data, extra = {}) {
	return JSON.stringify({ type, seq: 0, time: extra.time ?? 1700000000000, data, ...extra });
}

function header(over = {}) {
	return JSON.stringify({ type: "session", version: 0, id: "session-abc", cwd: "/tmp/ws", createdAt: 1700000000000, ...over });
}

test("foldSessionLog reads the header, title and last model context", () => {
	const fold = foldSessionLog([
		header(),
		line("session/title", { title: "My task" }),
		line("request/context", { provider: "p1", model: "m1", contextWindow: 1000 }),
		line("request/context", { provider: "p2", model: "m2", contextWindow: 2000 })
	].join("\n"));
	assert.equal(fold.header.cwd, "/tmp/ws");
	assert.equal(fold.header.id, "session-abc");
	assert.equal(fold.title, "My task");
	assert.equal(fold.lastContext.provider, "p2");
	assert.equal(fold.lastContext.model, "m2");
});

test("foldSessionLog attributes produced files from write/edit tool calls paired by callId", () => {
	const fold = foldSessionLog([
		header(),
		line("tool/call", { turn: 1, step: 1, callId: "c1", name: "write", arguments: JSON.stringify({ file_path: "/tmp/ws/a.md", content: "x" }) }),
		line("tool/result", { turn: 1, step: 1, message: { id: "r1", role: "user", content: [{ type: "tool-result", toolCallId: "c1", content: "ok", isError: false }], source: { kind: "tool", callId: "c1" } } }),
		line("tool/call", { turn: 1, step: 2, callId: "c2", name: "edit", arguments: JSON.stringify({ file_path: "rel/b.ts", old_string: "a", new_string: "b" }) }),
		line("tool/result", { turn: 1, step: 2, message: { id: "r2", role: "user", content: [{ type: "tool-result", toolCallId: "c2", content: "err", isError: true }], source: { kind: "tool", callId: "c2" } } }),
		line("tool/call", { turn: 2, step: 1, callId: "c3", name: "write", arguments: JSON.stringify({ file_path: "/tmp/ws/a.md", content: "y" }) }, { time: 1700000005000 }),
		line("tool/result", { turn: 2, step: 1, message: { id: "r3", role: "user", content: [{ type: "tool-result", toolCallId: "c3", content: "ok", isError: false }], source: { kind: "tool", callId: "c3" } } })
	].join("\n"));
	assert.equal(fold.produced.size, 2);
	const a = fold.produced.get("/tmp/ws/a.md");
	assert.ok(a, "absolute path produced");
	assert.deepEqual(a.ops, ["write"]);
	assert.equal(a.count, 2);
	assert.equal(a.lastTime, 1700000005000);
	assert.equal(a.ok, true);
	const b = fold.produced.get("rel/b.ts");
	assert.ok(b, "relative path produced as-is");
	assert.equal(b.ok, false, "failed edit recorded as not-ok");
	assert.deepEqual(b.ops, ["edit"]);
});

test("foldSessionLog maps str_replace_editor mutations and skips views", () => {
	const fold = foldSessionLog([
		header(),
		line("tool/call", { turn: 1, step: 1, callId: "v", name: "str_replace_editor", arguments: JSON.stringify({ command: "view", path: "/tmp/ws/read.me" }) }),
		line("tool/result", { turn: 1, step: 1, message: { id: "rv", role: "user", content: [{ type: "tool-result", toolCallId: "v", content: "ok", isError: false }], source: { kind: "tool", callId: "v" } } }),
		line("tool/call", { turn: 1, step: 2, callId: "c", name: "str_replace_editor", arguments: JSON.stringify({ command: "create", path: "/tmp/ws/new.txt", file_text: "x" }) }),
		line("tool/result", { turn: 1, step: 2, message: { id: "rc", role: "user", content: [{ type: "tool-result", toolCallId: "c", content: "ok", isError: false }], source: { kind: "tool", callId: "c" } } })
	].join("\n"));
	assert.equal(fold.produced.has("/tmp/ws/read.me"), false, "view is a read, not an artifact");
	assert.equal(fold.produced.get("/tmp/ws/new.txt").ops[0], "create");
});

test("foldSessionLog ignores unpaired calls and non-mutation tools", () => {
	const fold = foldSessionLog([
		header(),
		line("tool/call", { turn: 1, step: 1, callId: "lost", name: "write", arguments: JSON.stringify({ file_path: "/tmp/ws/gone.txt", content: "x" }) }),
		line("tool/call", { turn: 1, step: 2, callId: "b1", name: "bash", arguments: JSON.stringify({ command: "ls" }) }),
		line("tool/result", { turn: 1, step: 2, message: { id: "rb", role: "user", content: [{ type: "tool-result", toolCallId: "b1", content: "ok", isError: false }], source: { kind: "tool", callId: "b1" } } }),
		line("tool/call", { turn: 1, step: 3, callId: "r1", name: "read", arguments: JSON.stringify({ file_path: "/tmp/ws/a.md" }) }),
		line("tool/result", { turn: 1, step: 3, message: { id: "rr", role: "user", content: [{ type: "tool-result", toolCallId: "r1", content: "ok", isError: false }], source: { kind: "tool", callId: "r1" } } })
	].join("\n"));
	assert.equal(fold.produced.size, 0, "no result, no read tools, no bash → nothing produced");
});

test("foldSessionLog extracts the chat transcript (user + assistant, no tool results)", () => {
	const fold = foldSessionLog([
		header({ id: "session-child" }),
		line("user/message", { id: "u1", role: "user", content: [{ type: "text", text: "hello" }], source: { kind: "user" } }),
		line("user/message", { id: "t1", role: "user", content: [{ type: "tool-result", toolCallId: "x", content: "ok", isError: false }], source: { kind: "tool", callId: "x" } }),
		line("assistant/message", { turn: 1, step: 1, message: { id: "a1", role: "assistant", content: [{ type: "text", text: "hi " }, { type: "text", text: "there" }], source: { kind: "model" } } }),
		line("assistant/message", { turn: 1, step: 2, message: { id: "a2", role: "assistant", content: [{ type: "text", text: "partial" }], source: { kind: "model" } }, interrupted: true })
	].join("\n"));
	assert.equal(fold.messages.length, 3, "two assistant text messages survive; the tool result does not");
	assert.deepEqual(fold.messages[0], { role: "user", text: "hello", time: 1700000000000, seq: 0 });
	assert.equal(fold.messages[1].text, "hi \nthere");
	assert.equal(fold.messages[1].interrupted, false);
	assert.equal(fold.messages[2].text, "partial");
	assert.equal(fold.messages[2].interrupted, true);
});

test("resolveInside rejects traversal, escapes and the base itself", () => {
	assert.deepEqual(resolveInside("/tmp/ws", "src/a.ts"), { ok: true, abs: "/tmp/ws/src/a.ts", rel: "src/a.ts" });
	assert.equal(resolveInside("/tmp/ws", "/tmp/ws/a.ts").ok, true);
	assert.equal(resolveInside("/tmp/ws", "../secret").ok, false);
	assert.equal(resolveInside("/tmp/ws", "/etc/passwd").ok, false);
	assert.equal(resolveInside("/tmp/ws", "/tmp/ws").ok, false);
	assert.equal(resolveInside("/tmp/ws", "a/../../b").ok, false);
	assert.equal(resolveInside("", "x").ok, false);
	assert.equal(resolveInside("/tmp/ws", "").ok, false);
	assert.equal(resolveInside("/tmp/ws", "/tmp/ws-x/c").ok, false, "sibling prefix must not pass");
});

test("classifyKind covers text, image and binary", () => {
	assert.equal(classifyKind("a.md"), "text");
	assert.equal(classifyKind("noext"), "text");
	assert.equal(classifyKind("a.png"), "image");
	assert.equal(classifyKind("a.jpg"), "image");
	assert.equal(classifyKind("a.exe"), "binary");
	assert.equal(classifyKind("a.zip"), "binary");
});

test("foldSessionLog cuts fork-inherited history at the header seedLength", () => {
	const withSeq = (obj, seq) => JSON.stringify(Object.assign({ seq }, obj));
	const fold = foldSessionLog([
		JSON.stringify({ type: "session", id: "child", cwd: "/w", createdAt: 1, seedLength: 100, origin: "subagent" }),
		withSeq({ type: "user/message", time: 1, data: { content: [{ type: "text", text: "inherited" }], source: { kind: "user" } } }, 5),
		withSeq({ type: "assistant/message", time: 2, data: { message: { content: [{ type: "text", text: "inherited reply" }] } } }, 60),
		withSeq({ type: "user/message", time: 3, data: { content: [{ type: "text", text: "own question" }], source: { kind: "user" } } }, 101),
		withSeq({ type: "assistant/message", time: 4, data: { message: { content: [{ type: "text", text: "own answer" }] } } }, 120)
	].join("\n"));
	assert.equal(fold.messages.length, 4);
	assert.equal(fold.ownStart, 2, "first message at seq >= seedLength is the child's own");
	assert.equal(fold.messages[fold.ownStart].text, "own question");
	assert.equal(fold.messages[3].text, "own answer");
});

test("decodeZstdLog handles multi-frame concatenation like real session logs", () => {
	if (typeof zstdCompressSync !== "function") return; // older node without zstd
	const buf = Buffer.concat([
		zstdCompressSync(Buffer.from(line("session/title", { title: "one" }) + "\n")),
		zstdCompressSync(Buffer.from(line("request/context", { provider: "p", model: "m" }) + "\n"))
	]);
	const fold = foldSessionLog(decodeZstdLog(buf));
	assert.equal(fold.title, "one");
	assert.equal(fold.lastContext.model, "m");
});
