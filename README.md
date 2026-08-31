# dsh-sidepanel

A Codex-style right side panel for the DSH (DeepSeek Harness) web UI at http://127.0.0.1:3080/: an **Artifacts** view and a **Side chat**, both bound to the current task session. Ships as a static profile plugin that auto-loads with DSH — no core code changes.

- **Artifacts**: folds the session log (`~/.dsh/sessions/…/session.jsonl.zstd`, multi-frame zstd) and lists every file the session created or modified through `write` / `edit` / `str_replace_editor` tools — name, kind, path, size, mtime, source, change count. Search, source filter, copy path, reveal in Finder, safe text/code/Markdown/image preview, and an opt-in workspace mtime scan that catches bash-created files.
- **Side chat**: a continuable **fork** subagent child (native `ctx.subagents`) — inherits the session's completed-turn context and model, never touches the main transcript. SSE streaming, stop, retry, interrupted markers, replay across refreshes and DSH restarts. A persona keeps it answering directly instead of running off on tool sprees.
- **Panel**: toggle button in the session-header utilities (top-right); dock mode appends a fourth track to the frame's inline `grid-template-columns` so the main content is **squeezed, never covered**; narrow viewports fall back to a shadowed overlay. Drag or ←/→ to resize; Esc closes preview → clears search → collapses the panel and restores focus. Open/width/tab/scan persist in localStorage.

## Install

```bash
cd <this directory>
node scripts/install.mjs              # idempotent: symlink + cordis.patch.yml insert row
node scripts/install.mjs --restart    # also kickstart DSH so it loads immediately
curl http://127.0.0.1:3080/sidepanel/health   # → {"ok":true,"addon":"dsh-sidepanel",...,"chat":true}
```

## Enable / disable / uninstall

- Enabled = installed (insert row + symlink present).
- Disable: remove the `- id: sidepanel / name: dsh-sidepanel` row from `~/.dsh/profiles/web/cordis.patch.yml`, then `launchctl kickstart -k gui/$(id -u)/com.deepseek.dsh`.
- Uninstall: `node scripts/install.mjs --uninstall` (removes the row and symlink, restarts DSH).

See `README.zh.md` for the full troubleshooting table and known limitations (Chinese).

## Tests

```bash
node --test test/host.test.mjs test/safety.test.mjs test/client.test.mjs
```

Covers artifact attribution folding, fork seed boundary (`seedLength`), path containment math, real-filesystem preview safety (traversal / symlink escape / mismatched ids), multi-frame zstd, panel state sanitization and persistence, grid-track math (dock/overlay/closed), the chat state machine, and idempotent slot registration.

MIT license.

## What's new in 1.1.0

- **Side-chat model picker**: a model button above the composer opens a listbox populated from the same LLM catalog the main chat uses (via the harness `llm` service). The current model is highlighted; "Follow main chat" restores the inherited routing. The choice persists in `localStorage["dsh-sidepanel.v1"]`.
- **Switching takes effect on send**: the send payload carries the chosen model. The harness pins a child's routing at creation (`followup` cannot change it), so a different routing transparently starts a new fork child; older side-chat exchanges are preserved and merged in replay order.
- **Send-to-bottom & smart scroll**: after sending, the view sticks to the newest message; streaming keeps following while pinned to the bottom; scrolling up pauses auto-follow (no more yanking), showing a "Jump to latest" pill until you return to the bottom.
- New host route `GET /sidepanel/chat/models`; `POST /sidepanel/chat/send` accepts an optional `model`; `/sidepanel/chat/state` merges multi-child replays and reports `childModel`.
- 26 unit tests (model catalog normalization, stick-mode math, persisted-choice sanitization added).

Full details: `CHANGELOG-1.1.0.zh.md`, `UX-SUGGESTIONS.zh.md`, `selftest/SELFTEST.zh.md` (Chinese).
