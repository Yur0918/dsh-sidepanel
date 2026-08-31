// dsh-sidepanel browser half: a Codex-style right side panel for DSH.
// Toggle button in the session header utilities; the panel itself renders in
// the shell.overlay slot and squeezes the main grid by appending a fourth
// track to the frame's inline grid-template-columns (never covering content
// unless the viewport is too narrow, where it falls back to overlay mode).
//
// Panel state (open / width / tab / scan toggle) persists in localStorage;
// chat transcripts persist on the host side (fork-child session logs) and are
// replayed through /sidepanel/chat/state after refreshes and DSH restarts.

window.__ModuleLoader__.load({
	id: "dsh-sidepanel",
	factory: function (require) {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		let Prim = null;
		try {
			Prim = require("@deepseek-ai/dsh-client-ui-primitives");
		} catch (e) {
			Prim = null;
		}

		const ZH = (typeof navigator !== "undefined" && String(navigator.language || "").toLowerCase().startsWith("zh"));
		const T = ZH ? {
			panelName: "侧边面板",
			tabArtifacts: "产物",
			tabChat: "侧聊",
			close: "收起面板",
			open: "展开侧边面板",
			noSession: "没有活动会话",
			noSessionHint: "在左侧选择或新建一个会话后,这里会显示该会话的产物与侧聊。",
			session: "当前会话",
			syncOk: "已同步",
			syncing: "同步中",
			syncError: "同步失败",
			refresh: "刷新",
			search: "搜索名称 / 路径 / 类型",
			filterAll: "全部",
			filterTool: "工具产出",
			filterScan: "工作区扫描",
			scanToggle: "含扫描来源",
			empty: "该会话还没有产物",
			emptyHint: "会话通过 write / edit 等工具生成或修改文件后,会出现在这里。",
			emptyScan: "没有匹配的文件",
			loadFail: "加载失败",
			retry: "重试",
			showMore: "显示更多",
			copyPath: "复制路径",
			copied: "已复制",
			reveal: "在访达中显示",
			preview: "预览",
			previewTruncated: "内容过长,已截断",
			previewBinary: "二进制文件,不支持预览",
			previewMissing: "文件已不存在",
			previewDenied: "路径超出会话工作区范围",
			sourceTool: "工具",
			sourceScan: "扫描",
			missing: "已删除",
			changes: "次改动",
			chatPlaceholder: "向当前会话的侧聊提问… (Enter 发送, Shift+Enter 换行)",
			send: "发送",
			stop: "停止",
			stopping: "停止中",
			streaming: "生成中",
			idle: "空闲",
			error: "出错了",
			retryLast: "重试上一条",
			interrupted: "已中断",
			connLost: "连接中断,重连中",
			model: "模型",
			modelDefault: "跟随主对话",
			modelFollowMain: "跟随主对话",
			modelInherited: "当前跟随主对话的模型，点击可指定",
			modelOverride: "已指定模型，点击可更换",
			modelListFail: "模型列表加载失败：",
			modelListEmpty: "暂无可用模型",
			jumpLatest: "回到最新",
			chatIntro: "侧聊继承当前会话的上下文，不会写进主对话。发送前可在下方切换模型。",
			tooMany: "条,仅显示前",
			widthHint: "拖动或用 ←/→ 调整宽度"
		} : {
			panelName: "Side panel",
			tabArtifacts: "Artifacts",
			tabChat: "Side chat",
			close: "Collapse panel",
			open: "Open side panel",
			noSession: "No active session",
			noSessionHint: "Select or start a session on the left; its artifacts and side chat will show up here.",
			session: "Current session",
			syncOk: "synced",
			syncing: "syncing",
			syncError: "sync failed",
			refresh: "Refresh",
			search: "Search name / path / type",
			filterAll: "All",
			filterTool: "Tool output",
			filterScan: "Workspace scan",
			scanToggle: "include scan",
			empty: "No artifacts yet",
			emptyHint: "Files this session creates or edits with write / edit tools will appear here.",
			emptyScan: "No matching files",
			loadFail: "Failed to load",
			retry: "Retry",
			showMore: "Show more",
			copyPath: "Copy path",
			copied: "Copied",
			reveal: "Reveal in Finder",
			preview: "Preview",
			previewTruncated: "truncated (file is longer)",
			previewBinary: "Binary file, no preview",
			previewMissing: "File no longer exists",
			previewDenied: "Path is outside the session workspace",
			sourceTool: "tool",
			sourceScan: "scan",
			missing: "deleted",
			changes: "changes",
			chatPlaceholder: "Ask the side chat of this session… (Enter to send, Shift+Enter for newline)",
			send: "Send",
			stop: "Stop",
			stopping: "stopping",
			streaming: "generating",
			idle: "idle",
			error: "error",
			retryLast: "Retry last",
			interrupted: "interrupted",
			connLost: "connection lost, reconnecting",
			model: "model",
			modelDefault: "Follow main chat",
			modelFollowMain: "Follow main chat",
			modelInherited: "Following the main chat's model; click to choose",
			modelOverride: "Model pinned for the side chat; click to change",
			modelListFail: "Model list failed to load:",
			modelListEmpty: "No models available",
			jumpLatest: "Jump to latest",
			chatIntro: "The side chat inherits this session's context and never writes into the main chat. Pick a model below before sending.",
			tooMany: "items, showing first",
			widthHint: "Drag or use ←/→ to resize"
		};

		// ── constants mirroring the DSH layout contract ───────────────────────
		const CENTER_MIN = 640;
		const PANEL_MIN = 280;
		const PANEL_MAX = 560;
		const PANEL_DEFAULT = 380;
		const STORE_KEY = "dsh-sidepanel.v1";
		// React renders the frame template as "280px minmax(0px, 1fr) 0px"
		// (older builds: "minmax(0, 1fr)") — accept both
		const GRID_RE = /^(\d+(?:\.\d+)?)px minmax\(0(?:px)?,\s*1fr\) (\d+(?:\.\d+)?)px$/;

		// ── pure helpers (exported for unit tests) ────────────────────────────
		function clampPanelWidth(px) {
			const n = Math.round(Number(px));
			if (!Number.isFinite(n)) return PANEL_DEFAULT;
			return Math.min(PANEL_MAX, Math.max(PANEL_MIN, n));
		}

		function sanitizeState(raw) {
			const src = (raw !== null && typeof raw === "object") ? raw : {};
			return {
				open: src.open === true,
				width: clampPanelWidth(src.width !== undefined ? src.width : PANEL_DEFAULT),
				tab: src.tab === "chat" ? "chat" : "art",
				includeScan: src.includeScan === true,
				chatModel: typeof src.chatModel === "string" && src.chatModel.trim() !== "" ? src.chatModel : null
			};
		}

		function loadPersistedState(storage) {
			try {
				const raw = storage.getItem(STORE_KEY);
				return sanitizeState(raw === null ? {} : JSON.parse(raw));
			} catch (e) {
				return sanitizeState({});
			}
		}

		// compute the docked track width for the frame grid; track 0 means the
		// panel must fall back to overlay mode (viewport too narrow for CENTER_MIN)
		function computeTrack(frameWidth, gridTemplate, panelWidth) {
			if (!(panelWidth > 0)) return { track: 0, mode: "closed" };
			const m = GRID_RE.exec(String(gridTemplate || ""));
			if (m === null) return { track: 0, mode: "overlay" };
			const used = Number(m[1]) + Number(m[2]);
			const available = frameWidth - used - CENTER_MIN;
			const track = Math.min(panelWidth, Math.max(0, available));
			if (track < PANEL_MIN) return { track: 0, mode: "overlay" };
			return { track, mode: "dock" };
		}

		function filterArtifacts(items, query, source) {
			const q = String(query || "").trim().toLowerCase();
			return (items || []).filter(function (item) {
				if (source === "tool" && item.source !== "tool") return false;
				if (source === "scan" && item.source !== "scan") return false;
				if (q === "") return true;
				return item.name.toLowerCase().indexOf(q) !== -1
					|| item.relPath.toLowerCase().indexOf(q) !== -1
					|| (item.ext || "").indexOf(q) !== -1
					|| (item.kind || "").indexOf(q) !== -1;
			});
		}

		function relTime(ms, now) {
			const t = Number(ms) || 0;
			if (t <= 0) return "";
			const diff = Math.max(0, (now || Date.now()) - t);
			if (diff < 60000) return Math.max(1, Math.round(diff / 1000)) + "s";
			if (diff < 3600000) return Math.round(diff / 60000) + "m";
			if (diff < 86400000) return Math.round(diff / 3600000) + "h";
			return Math.round(diff / 86400000) + "d";
		}

		function humanSize(b) {
			const n = Number(b);
			if (!Number.isFinite(n) || n < 0) return "";
			if (n < 1024) return n + " B";
			if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
			return (n / 1048576).toFixed(1) + " MB";
		}

		// ── smart scroll (send-to-bottom “吸顶” + no-jump during streaming) ──
		// Pure decision math: the view follows new content only while the user
		// is already at (or near) the bottom; any manual upward scroll pauses
		// following until they return to the bottom (or press the jump button).
		const STICK_THRESHOLD_PX = 48; // bottom proximity window
		function stickModeFor({ distanceFromBottom, userPinned, height, contentHeight }) {
			const atBottom = distanceFromBottom <= STICK_THRESHOLD_PX;
			if (userPinned === true) return "follow"; // user pressed “jump to latest”
			if (atBottom) return "follow"; // near bottom: keep following
			return "pause"; // user scrolled up: never steal their position
		}
		// should an auto-scroll be applied for the latest content change?
		function shouldAutoScroll(mode, hasNewContent) {
			return mode === "follow" && hasNewContent === true;
		}

		// ── model list + persisted choice ────────────────────────────────────
		// normalize {models:[…]|[…]} into [{id,label}] with provider/model ids
		function normalizeModelList(raw) {
			// accepts: array | {models:[…]} | the /chat/models catalog {groups:[{id,models:[…]}]}
			let arr;
			if (Array.isArray(raw)) arr = raw;
			else if (raw !== null && typeof raw === "object" && Array.isArray(raw.groups)) {
				arr = [];
				for (const g of raw.groups) {
					if (g === null || typeof g !== "object" || !Array.isArray(g.models)) continue;
					for (const m of g.models) {
						// host already flattened ids to "provider/model" — keep them,
						// only prefix bare group-local ids when needed
						const rawId = String((typeof m === "object" && m !== null) ? (m.id ?? m.model ?? m.name ?? "") : (m ?? ""));
						const fullId = rawId.includes("/") ? rawId : (g.id ? g.id + "/" + rawId : rawId);
						arr.push(typeof m === "object" && m !== null
							? Object.assign({}, m, { id: fullId, label: String(m.name ?? m.label ?? m.title ?? m.displayName ?? m.id ?? m.model ?? ""), provider: g.id ?? null })
							: { id: fullId, label: rawId, provider: g.id ?? null });
					}
				}
			}
			else arr = (raw !== null && typeof raw === "object" && Array.isArray(raw.models)) ? raw.models : [];
			const out = [];
			const seen = new Set();
			for (const item of arr) {
				let id = "";
				let label = "";
				let provider = null;
				if (item !== null && typeof item === "object") {
					id = String(item.id ?? item.model ?? item.value ?? item.name ?? "");
					label = String(item.label ?? item.title ?? item.displayName ?? item.name ?? id);
					provider = typeof item.provider === "string" && item.provider !== "" ? item.provider : (typeof item.vendor === "string" ? item.vendor : null);
				} else if (item === null || item === undefined) {
					continue;
				} else {
					id = String(item ?? "");
					label = id;
				}
				if (id === "" || seen.has(id)) continue;
				seen.add(id);
				out.push({ id, label, provider });
			}
			return out;
		}
		// persisted user choice: prefer the global pick, then the per-session pick
		function pickStoredModel(globalRaw, sessionRaw) {
			const g = typeof globalRaw === "string" && globalRaw.trim() !== "" ? globalRaw : null;
			const s = typeof sessionRaw === "string" && sessionRaw.trim() !== "" ? sessionRaw : null;
			return { global: g, session: s, effective: s ?? g };
		}

		// chat state machine: phase idle → streaming → (stopping) → idle | error
		function chatInitial() {
			return { phase: "idle", messages: [], partial: "", lastUser: "", error: "", turnReason: null, modelOverride: null };
		}

		function chatReducer(state, action) {
			switch (action.type) {
				case "reset":
					return chatInitial();
				case "restore":
					return {
						phase: action.running === true ? "streaming" : "idle",
						messages: Array.isArray(action.messages) ? action.messages.slice() : [],
						partial: typeof action.partial === "string" ? action.partial : "",
						lastUser: "",
						error: "",
						turnReason: null,
						modelOverride: typeof action.modelOverride === "string" && action.modelOverride !== "" ? action.modelOverride : null
					};
				case "send": {
					if (typeof action.text !== "string" || action.text.trim() === "") return state;
					return {
						phase: "streaming",
						messages: state.messages.concat([{ role: "user", text: action.text, time: Date.now() }]),
						partial: "",
						lastUser: action.text,
						error: "",
						turnReason: null
					};
				}
				case "delta":
					if (state.phase !== "streaming" && state.phase !== "stopping") return state;
					return Object.assign({}, state, { partial: state.partial + (action.text || "") });
				case "assistant": {
					const text = typeof action.text === "string" ? action.text : "";
					const messages = state.messages.concat([{ role: "assistant", text, interrupted: action.interrupted === true, time: Date.now() }]);
					return Object.assign({}, state, { messages, partial: "", turnReason: null });
				}
				case "turn-start":
					return Object.assign({}, state, { phase: state.phase === "stopping" ? "stopping" : "streaming" });
				case "model-pick": {
					// null/empty clears the override back to "follow the main chat"
					const model = typeof action.model === "string" && action.model.trim() !== "" ? action.model.trim() : null;
					if (model === state.modelOverride) return state;
					return Object.assign({}, state, { modelOverride: model });
				}
				case "turn-end": {
					let messages = state.messages;
					if (state.partial !== "") {
						// stream ended without a final assistant/message row
						messages = messages.concat([{ role: "assistant", text: state.partial, interrupted: true, time: Date.now() }]);
					}
					return Object.assign({}, state, { phase: "idle", messages, partial: "", turnReason: action.reason || null });
				}
				case "stop-requested":
					if (state.phase !== "streaming") return state;
					return Object.assign({}, state, { phase: "stopping" });
				case "error": {
					let messages = state.messages;
					if (state.partial !== "") {
						messages = messages.concat([{ role: "assistant", text: state.partial, interrupted: true, time: Date.now() }]);
					}
					return Object.assign({}, state, { phase: "error", messages, partial: "", error: String(action.error || "error") });
				}
				case "retry": {
					// drop the trailing user turn (and any assistant reply after it)
					const msgs = state.messages.slice();
					while (msgs.length > 0 && msgs[msgs.length - 1].role === "assistant") msgs.pop();
					if (msgs.length > 0 && msgs[msgs.length - 1].role === "user") msgs.pop();
					return Object.assign({}, state, { messages: msgs, partial: "", phase: "idle", error: "" });
				}
				default:
					return state;
			}
		}

		exports._pure = {
			clampPanelWidth, sanitizeState, loadPersistedState, computeTrack,
			filterArtifacts, relTime, humanSize, chatInitial, chatReducer,
			stickModeFor, normalizeModelList, pickStoredModel,
			PANEL_MIN, PANEL_MAX, PANEL_DEFAULT, STORE_KEY
		};

		// ── CSS ───────────────────────────────────────────────────────────────
		const CSS = `
.dsp-panel,.dsp-panel *{box-sizing:border-box}
.dsp-panel{position:absolute;top:0;right:0;bottom:0;display:flex;flex-direction:column;pointer-events:auto;background:var(--dsw-alias-bg-layer-1,#fff);border-left:1px solid var(--dsw-alias-border-l2-darkmode-thin,#e2e5ea);font-size:13px;color:var(--dsw-alias-label-primary);z-index:30;min-width:0}
.dsp-panel[data-mode="overlay"]{box-shadow:var(--dsw-shadow-lv3,0 8px 28px rgba(0,0,0,.18));background:var(--dsw-alias-bg-layer-2,#fff)}
.dsp-resizer{position:absolute;left:-4px;top:0;bottom:0;width:8px;cursor:col-resize;z-index:2}
.dsp-resizer::after{content:"";position:absolute;left:3px;top:0;bottom:0;width:2px;background:transparent;transition:background .12s ease}
.dsp-resizer:hover::after,.dsp-resizer[data-dragging="true"]::after{background:#3964fe}
.dsp-head{display:flex;flex-direction:column;gap:4px;padding:12px 14px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,#eef0f3)}
.dsp-head-row{display:flex;align-items:center;gap:8px}
.dsp-title{font-weight:600;font-size:13px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsp-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;gap:6px;min-width:0}
.dsp-sub code{font-family:ui-monospace,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsp-sync{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex:none}
.dsp-sync-dot{width:6px;height:6px;border-radius:50%;background:#17795e;flex:none}
.dsp-sync[data-state="loading"] .dsp-sync-dot{background:#c9a227;animation:dsp-pulse 1s ease infinite}
.dsp-sync[data-state="error"] .dsp-sync-dot{background:#d33}
.dsp-sync[data-state="live"] .dsp-sync-dot{background:#3964fe;animation:dsp-pulse 1.2s ease infinite}
@keyframes dsp-pulse{50%{opacity:.35}}
.dsp-iconbtn{border:none;background:transparent;color:var(--dsw-alias-label-secondary);width:26px;height:26px;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;flex:none;font-family:inherit}
.dsp-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsp-iconbtn[aria-pressed="true"]{color:#3964fe;background:rgba(57,100,254,.10)}
.dsp-iconbtn:disabled{opacity:.4;cursor:default}
.dsp-tabs{display:flex;gap:2px;padding:6px 10px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#eef0f3)}
.dsp-tab{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px;padding:6px 10px 7px;cursor:pointer;border-radius:8px 8px 0 0;border-bottom:2px solid transparent;font-family:inherit;display:inline-flex;gap:6px;align-items:center}
.dsp-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsp-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary);border-bottom-color:#3964fe;font-weight:550}
.dsp-tab-count{font-size:10.5px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover,#eef0f3);border-radius:99px;padding:0 6px;line-height:16px}
.dsp-body{flex:1;min-height:0;display:flex;flex-direction:column}
.dsp-toolbar{display:flex;gap:6px;padding:10px 12px 6px;align-items:center}
.dsp-search{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2-darkmode-thin,#c9ced6);background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary);border-radius:9px;padding:5px 10px;font-size:12.5px;font-family:inherit;outline:none;height:28px}
.dsp-search:focus{border-color:#3964fe}
.dsp-chips{display:flex;gap:4px;flex:none}
.dsp-chip{border:1px solid var(--dsw-alias-border-l2-darkmode-thin,#c9ced6);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:99px;padding:2px 9px;font-size:11px;cursor:pointer;font-family:inherit;white-space:nowrap}
.dsp-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsp-chip[aria-pressed="true"]{border-color:#3964fe;color:#3964fe;background:rgba(57,100,254,.08)}
.dsp-list{flex:1;min-height:0;overflow-y:auto;padding:2px 10px 12px;display:flex;flex-direction:column;gap:6px}
.dsp-row{border:1px solid var(--dsw-alias-border-l1,#e8eaee);border-radius:10px;padding:7px 10px;display:flex;flex-direction:column;gap:4px;background:transparent}
.dsp-row:hover{border-color:var(--dsw-alias-border-l2-darkmode-thin,#c9ced6)}
.dsp-row[data-missing="true"]{opacity:.55}
.dsp-row-main{display:flex;align-items:center;gap:8px;min-width:0}
.dsp-row-icon{width:26px;height:26px;border-radius:7px;color:#fff;font-size:8.5px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none;letter-spacing:.02em;overflow:hidden}
.dsp-row-name{font-weight:500;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;border:none;background:transparent;color:inherit;cursor:pointer;padding:0;font-family:inherit;font-size:12.5px}
.dsp-row-name:hover{text-decoration:underline}
.dsp-row-meta{font-size:10.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsp-row-actions{display:flex;gap:2px;margin-left:auto;flex:none}
.dsp-row-actions .dsp-iconbtn{width:24px;height:24px}
.dsp-tags{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.dsp-tag{font-size:10px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2-darkmode-thin,#d8dce2);border-radius:5px;padding:0 5px;line-height:16px;white-space:nowrap}
.dsp-tag[data-kind="missing"]{color:#b3422f;border-color:#e2b4aa}
.dsp-preview{border-top:1px dashed var(--dsw-alias-border-l2-darkmode-thin,#d8dce2);margin-top:4px;padding-top:6px;display:flex;flex-direction:column;gap:6px}
.dsp-preview pre{margin:0;max-height:260px;overflow:auto;background:var(--dsw-alias-interactive-bg-hover,#f2f4f7);border-radius:8px;padding:8px 10px;font-size:11px;line-height:1.55;font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary)}
.dsp-preview img{max-width:100%;max-height:280px;border-radius:8px;align-self:flex-start}
.dsp-preview-note{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.dsp-preview-error{font-size:11.5px;color:#d33}
.dsp-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:var(--dsw-alias-label-tertiary);padding:30px 20px;text-align:center}
.dsp-empty-title{font-size:13px;color:var(--dsw-alias-label-secondary)}
.dsp-empty-hint{font-size:11.5px;line-height:1.6;max-width:260px}
.dsp-error{margin:8px 12px;padding:8px 12px;border-radius:9px;background:rgba(211,47,47,.08);color:#b3422f;font-size:12px;display:flex;align-items:center;gap:8px}
.dsp-more{align-self:center;margin:2px 0 6px;border:1px solid var(--dsw-alias-border-l2-darkmode-thin,#c9ced6);background:transparent;border-radius:8px;padding:3px 12px;font-size:11.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit}
.dsp-more:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsp-skel{padding:16px;color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center}
.dsp-chat{flex:1;min-height:0;display:flex;flex-direction:column;position:relative}
.dsp-chat-scroll{flex:1;min-height:0;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.dsp-msg{max-width:94%;border-radius:11px;padding:7px 11px;font-size:12.5px;line-height:1.6;word-break:break-word;white-space:pre-wrap;overflow-wrap:anywhere}
.dsp-msg-user{align-self:flex-end;background:#3964fe;color:#fff;border-bottom-right-radius:4px}
.dsp-msg-assistant{align-self:flex-start;background:var(--dsw-alias-interactive-bg-hover,#f2f4f7);border-bottom-left-radius:4px;color:var(--dsw-alias-label-primary)}
.dsp-msg-assistant.dsp-md{white-space:normal}
.dsp-msg-meta{font-size:10px;color:var(--dsw-alias-label-tertiary);margin-top:3px}
.dsp-caret{display:inline-block;width:7px;height:14px;background:#3964fe;vertical-align:-2px;animation:dsp-blink 1s steps(2) infinite;margin-left:2px;border-radius:1px}
@keyframes dsp-blink{50%{opacity:0}}
.dsp-chat-intro{align-self:center;text-align:center;font-size:11px;color:var(--dsw-alias-label-tertiary);max-width:280px;line-height:1.6;padding:6px 0}
.dsp-chat-status{display:flex;align-items:center;gap:6px;padding:4px 14px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);border-top:1px solid var(--dsw-alias-border-l1,#eef0f3);min-height:24px;min-width:0}
.dsp-chat-status-model{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsp-chat-status-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}
.dsp-chat-status[data-phase="streaming"] .dsp-chat-status-dot,.dsp-chat-status[data-phase="stopping"] .dsp-chat-status-dot{background:#c9a227;animation:dsp-pulse 1s ease infinite}
.dsp-chat-status[data-phase="error"] .dsp-chat-status-dot{background:#d33}
.dsp-composer{display:flex;flex-direction:column;gap:6px;padding:8px 12px 12px;border-top:1px solid var(--dsw-alias-border-l1,#eef0f3)}
.dsp-composer-row{display:flex;gap:8px;align-items:flex-end}
.dsp-composer-side{position:relative;flex:none}
.dsp-model-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2-darkmode-thin,#c9ced6);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:3px 9px;font-size:11px;cursor:pointer;font-family:inherit;max-width:100%}
.dsp-model-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsp-model-btn[aria-expanded="true"]{border-color:#3964fe;color:#3964fe}
.dsp-model-dot{width:6px;height:6px;border-radius:50%;background:#3964fe;flex:none}
.dsp-model-dot[data-inherited="true"]{background:var(--dsw-alias-label-tertiary,#9aa2ad)}
.dsp-model-name{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsp-model-caret{font-size:9px;line-height:1;flex:none}
.dsp-model-pop{position:absolute;bottom:calc(100% + 6px);left:0;min-width:240px;max-width:340px;max-height:280px;overflow-y:auto;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l2-darkmode-thin,#c9ced6);border-radius:10px;box-shadow:var(--dsw-shadow-lv3,0 8px 28px rgba(0,0,0,.16));padding:4px;z-index:40;display:flex;flex-direction:column}
.dsp-model-item{display:flex;align-items:center;gap:7px;border:none;background:transparent;color:var(--dsw-alias-label-primary);text-align:left;font-size:12px;padding:6px 8px;border-radius:7px;cursor:pointer;font-family:inherit;width:100%}
.dsp-model-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsp-model-item[aria-selected="true"]{background:rgba(57,100,254,.08);color:#3964fe;font-weight:550}
.dsp-model-check{width:14px;flex:none;text-align:center;font-size:11px}
.dsp-model-note{font-size:11px;color:var(--dsw-alias-label-tertiary);padding:6px 8px}
.dsp-chat-jump-wrap{position:absolute;right:14px;bottom:96px;z-index:5}
[data-conversation-scroll] [class*="flowItem"].dsp-main-sticky{position:sticky;top:8px;z-index:5}
[data-conversation-scroll] [class*="flowItem"].dsp-main-sticky > div:first-child{background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px;box-shadow:0 -6px 14px -8px rgba(0,0,0,.18);padding:2px 4px}
[data-conversation-scroll].dsp-main-tail::after{content:"";display:block;height:0}
.dsp-jump{background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-shadow-lv2,0 2px 10px rgba(0,0,0,.12));border-color:var(--dsw-alias-border-l2-darkmode-thin,#c9ced6)}
.dsp-input{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2-darkmode-thin,#c9ced6);background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary);border-radius:10px;padding:7px 10px;font-size:12.5px;font-family:inherit;outline:none;resize:none;max-height:120px;line-height:1.5}
.dsp-input:focus{border-color:#3964fe}
.dsp-send{border:none;background:#3964fe;color:#fff;border-radius:10px;padding:7px 13px;font-size:12.5px;cursor:pointer;font-family:inherit;flex:none}
.dsp-send:hover{background:#2f55d9}
.dsp-send:disabled{opacity:.45;cursor:default}
.dsp-stopbtn{border:1px solid var(--dsw-alias-border-l2-darkmode-thin,#c9ced6);background:transparent;color:var(--dsw-alias-label-primary);border-radius:10px;padding:7px 13px;font-size:12.5px;cursor:pointer;font-family:inherit;flex:none;display:inline-flex;align-items:center;gap:6px}
.dsp-stopbtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsp-chat-error{margin:0 12px 8px;padding:7px 10px;border-radius:9px;background:rgba(211,47,47,.08);color:#b3422f;font-size:11.5px;display:flex;gap:8px;align-items:center}
.dsp-chat-error button{border:1px solid #e2b4aa;background:transparent;color:#b3422f;border-radius:6px;font-size:11px;padding:1px 8px;cursor:pointer;font-family:inherit;flex:none}
`;

		function ensureStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css='dsh-sidepanel']") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-sidepanel";
			tag.dataset.pluginCss = "dsh-sidepanel";
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}


		// ── main-chat "send sticky top" (吸顶) ──────────────────────────────
		// When the user sends a message in the MAIN conversation, the harness
		// scrolls it to the bottom (its toBottom). We pin the NEW user message
		// row to the viewport TOP instead — question stays visible while the
		// answer streams below it (ChatGPT-style). Observer self-arms when the
		// conversation scroller appears and costs nothing otherwise.
		// compensates the details-column drag handle for the extra grid track
		function ensureFrameCss() {
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css='dsh-sidepanel-frame']") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.pluginCss = "dsh-sidepanel-frame";
			tag.textContent = "[data-sp-dock='1'] > [data-side='details']{transform:translateX(calc(-1 * var(--sp-track, 0px)))}";
			document.head.appendChild(tag);
		}

		function mainChatRows() {
			const sc = document.querySelector("[data-conversation-scroll]");
			if (sc === null) return null;
			const rows = sc.querySelectorAll('[class*="userRow"]');
			return rows.length > 0 ? { sc, rows } : null;
		}
		// CSS sticky does the pinning natively: the newest user row sticks to
			// the scroller top while the answer streams below it — no scrollTop
			// writes, zero conflict with the harness's own toBottom scrolling.
			const MAIN_STICKY_CLS = "dsp-main-sticky";
		// Only ONE user row may be sticky at a time — CSS sticky on every row
			// makes them stack at top:8px when scrolling up (visible overlap).
			// A scroll-driven picker pins exactly the last row whose natural
			// position crossed the top line. Natural offsets are measured with
			// sticky classes stripped (rect reads are polluted by the stuck
			// position) and cached between content mutations.
			let stickyCache = { sc: null, items: [], tops: [] };
			function measureStickyRows(sc) {
				const items = [...sc.querySelectorAll('[class*="flowItem"].' + MAIN_STICKY_CLS + ', [class*="userRow"]')]
					.map(function (r) { return r.closest('[class*="flowItem"]') || r; })
					.filter(function (item, i, arr) { return arr.indexOf(item) === i; });
				for (const item of items) item.classList.remove(MAIN_STICKY_CLS);
				const scRect = sc.getBoundingClientRect();
				const tops = items.map(function (item) {
					return Math.round(item.getBoundingClientRect().top - scRect.top + sc.scrollTop);
				});
				stickyCache = { sc: sc, items: items, tops: tops };
			}
			function mainChatApplySticky() {
				const sc = document.querySelector("[data-conversation-scroll]");
				if (sc === null) return;
				if (stickyCache.sc !== sc) { measureStickyRows(sc); }
				// pick the last row whose natural top crossed the line
				let pick = -1;
				for (let i = 0; i < stickyCache.tops.length; i++) {
					if (stickyCache.tops[i] - sc.scrollTop <= 10) pick = i; else break;
				}
				for (let i = 0; i < stickyCache.items.length; i++) {
					const want = i === pick;
					const item = stickyCache.items[i];
					if (want !== item.classList.contains(MAIN_STICKY_CLS)) {
						if (want) item.classList.add(MAIN_STICKY_CLS);
						else item.classList.remove(MAIN_STICKY_CLS);
					}
				}
			}
		function watchMainChat() {
			if (typeof MutationObserver === "undefined") return;
			const arm = () => {
				const sc = document.querySelector("[data-conversation-scroll]");
				if (sc === null) return false;
				let rafPending = 0;
				const schedule = () => {
					if (rafPending !== 0) return;
					rafPending = requestAnimationFrame(() => {
						rafPending = 0;
						measureStickyRows(sc);
						mainChatApplySticky();
					});
				};
				// content growth / new rows: full re-measure
				const mo = new MutationObserver(schedule);
				mo.observe(sc, { childList: true, subtree: true });
				// scrolling: switch the pinned row from cache (cheap)
				sc.addEventListener("scroll", () => mainChatApplySticky(), { passive: true });
				// conversation remount: re-arm on the new scroller
				const remount = new MutationObserver(() => {
					const sc2 = document.querySelector("[data-conversation-scroll]");
					if (sc2 !== null && sc2 !== sc) {
						remount.disconnect();
						mo.disconnect();
						stickyCache = { sc: null, items: [], tops: [] };
						arm();
					}
				});
				remount.observe(document.body, { childList: true, subtree: true });
				schedule();
				return true;
			};
			if (!arm()) setTimeout(arm, 1000);
		}
		// ── icons (inline SVG, currentColor — matches DSH outline style) ──────
		function svg(children) {
			return React.createElement("svg", { width: 15, height: 15, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, children);
		}
		const IconPanelRight = svg([
			React.createElement("rect", { key: "r", x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, stroke: "currentColor", strokeWidth: 1.3 }),
			React.createElement("line", { key: "l1", x1: 10.5, y1: 2.5, x2: 10.5, y2: 13.5, stroke: "currentColor", strokeWidth: 1.3 }),
			React.createElement("line", { key: "l2", x1: 4.5, y1: 8, x2: 7.5, y2: 8, stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" })
		]);
		const IconClose = svg([
			React.createElement("path", { key: "p", d: "M4 4l8 8M12 4l-8 8", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" })
		]);
		const IconCopy = svg([
			React.createElement("rect", { key: "r", x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5, stroke: "currentColor", strokeWidth: 1.3 }),
			React.createElement("path", { key: "p", d: "M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3.5A1.5 1.5 0 0 0 2 3v5.5A1.5 1.5 0 0 0 3.5 10H4", stroke: "currentColor", strokeWidth: 1.3 })
		]);
		const IconFolder = svg([
			React.createElement("path", { key: "p", d: "M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 2H13a1.5 1.5 0 0 1 1.5 1.5V12A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z", stroke: "currentColor", strokeWidth: 1.3, strokeLinejoin: "round" })
		]);
		const IconEye = svg([
			React.createElement("path", { key: "p", d: "M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z", stroke: "currentColor", strokeWidth: 1.3, strokeLinejoin: "round" }),
			React.createElement("circle", { key: "c", cx: 8, cy: 8, r: 1.8, stroke: "currentColor", strokeWidth: 1.3 })
		]);
		const IconStop = React.createElement("svg", { width: 11, height: 11, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
			React.createElement("rect", { x: 3.5, y: 3.5, width: 9, height: 9, rx: 1.5, fill: "currentColor" }));

		const KIND_COLORS = [
			[/^(png|jpe?g|gif|webp|svg|avif|heic|bmp|ico|tiff?)$/, "#a04fb0"],
			[/^(md|markdown|txt|log|json|ya?ml|toml|ini|conf|env)$/, "#4b7f9e"],
			[/^(js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|sh|sql|mjs|vue|svelte)$/, "#5a7c2e"],
			[/^(pdf)$/, "#c6343d"], [/^(zip|rar|7z|tar|gz|tgz)$/, "#8a6d1f"]
		];
		function kindColor(item) {
			if (item.kind === "image") return KIND_COLORS[0][1];
			for (const e of KIND_COLORS) if (e[0].test(item.ext || "")) return e[1];
			return "#6b7280";
		}

		// ── toggle button (session header utilities slot) ─────────────────────
		function ToggleButton() {
			const [state, set] = usePanelState();
			return React.createElement("button", {
				className: "dsp-iconbtn",
				type: "button",
				"aria-pressed": state.open ? "true" : "false",
				"aria-label": state.open ? T.close : T.open,
				title: state.open ? T.close + " (Esc)" : T.open,
				ref: (el) => { toggleBtnEl = el; },
				onClick: () => set({ open: !state.open })
			}, IconPanelRight);
		}

		// ── artifacts view ────────────────────────────────────────────────────
		function ArtifactsView({ sessionId, includeScan, onCount, onToggleScan }) {
			const [data, setData] = React.useState(null);
			const [error, setError] = React.useState("");
			const [loading, setLoading] = React.useState(false);
			const [query, setQuery] = React.useState("");
			const [source, setSource] = React.useState("all");
			const [limit, setLimit] = React.useState(80);
			const [preview, setPreview] = React.useState(null); // {path, loading, payload}
			const [copied, setCopied] = React.useState("");
			const searchRef = React.useRef(null);

			const reload = React.useCallback((silent) => {
				if (sessionId === undefined || sessionId === "") return;
				if (!silent) setLoading(true);
				apiGet("/sidepanel/artifacts?sessionId=" + encodeURIComponent(sessionId) + (includeScan ? "&scan=1" : ""))
					.then((res) => {
						setData(res);
						onCount(res.counts ? res.counts.total : 0);
					})
					.catch((e) => setError(e instanceof Error ? e.message : String(e)))
					.finally(() => setLoading(false));
			}, [sessionId, includeScan]);

			React.useEffect(() => { reload(false); }, [reload]);
			React.useEffect(() => {
				if (sessionId === undefined || sessionId === "") return;
				const timer = setInterval(() => {
					if (document.visibilityState === "visible") reload(true);
				}, 5000);
				return () => clearInterval(timer);
			}, [reload]);
			React.useEffect(() => { setLimit(80); setPreview(null); setQuery(""); setError(""); }, [sessionId]);

			const openPreview = (item) => {
				if (preview !== null && preview.path === item.path) {
					setPreview(null);
					return;
				}
				if (item.inside !== true || item.exists !== true) return; // outside/missing: nothing to fetch
				setPreview({ path: item.path, loading: true, payload: null });
				apiGet("/sidepanel/file?sessionId=" + encodeURIComponent(sessionId) + "&path=" + encodeURIComponent(item.path))
					.then((payload) => setPreview({ path: item.path, loading: false, payload }))
					.catch((e) => setPreview({ path: item.path, loading: false, payload: { ok: false, error: e instanceof Error ? e.message : String(e) } }));
			};

			const copyPath = (item) => {
				const done = () => { setCopied(item.path); setTimeout(() => setCopied(""), 1400); };
				if (Prim !== null && typeof Prim.writeClipboard === "function") {
					Prim.writeClipboard(item.path).then(done).catch(done);
				} else if (navigator.clipboard !== undefined) {
					navigator.clipboard.writeText(item.path).then(done).catch(done);
				}
			};

			const reveal = (item) => {
				apiPost("/sidepanel/reveal", { sessionId, path: item.path }).catch(() => {});
			};

			const items = data !== null ? filterArtifacts(data.items, query, source) : [];
			const shown = items.slice(0, limit);

			if (sessionId === undefined || sessionId === "") {
				return React.createElement("div", { className: "dsp-empty" },
					React.createElement("div", { className: "dsp-empty-title" }, T.noSession),
					React.createElement("div", { className: "dsp-empty-hint" }, T.noSessionHint));
			}

			return React.createElement(React.Fragment, null,
				React.createElement("div", { className: "dsp-toolbar" },
					React.createElement("input", {
						ref: searchRef, className: "dsp-search", type: "text", placeholder: T.search, value: query,
						"aria-label": T.search, onChange: (e) => setQuery(e.target.value)
					}),
					React.createElement("div", { className: "dsp-chips", role: "group" },
						[["all", T.filterAll], ["tool", T.filterTool], ["scan", T.filterScan]].map(([key, label]) =>
							React.createElement("button", {
								key: key, className: "dsp-chip", type: "button", "aria-pressed": source === key ? "true" : "false",
								onClick: () => setSource(key)
							}, label)))),
					onToggleScan !== undefined ? React.createElement("button", {
						className: "dsp-chip", type: "button", style: { alignSelf: "flex-end", margin: "0 12px 4px" },
						"aria-pressed": includeScan === true ? "true" : "false", onClick: onToggleScan
					}, (includeScan === true ? "✓ " : "") + T.scanToggle) : null,
				error !== "" ? React.createElement("div", { className: "dsp-error" },
					T.loadFail + ": " + error,
					React.createElement("button", { className: "dsp-chip", type: "button", onClick: () => reload(false) }, T.retry)) : null,
				data === null && error === ""
					? React.createElement("div", { className: "dsp-skel" }, T.syncing + "…")
					: items.length === 0
						? React.createElement("div", { className: "dsp-empty" },
							React.createElement("div", { className: "dsp-empty-title" },
								(query.trim() !== "" || source !== "all") ? T.emptyScan : T.empty),
							React.createElement("div", { className: "dsp-empty-hint" }, T.emptyHint))
						: React.createElement("div", { className: "dsp-list", role: "list" },
							shown.map((item) => React.createElement(ArtifactRow, {
								key: item.path, item, preview, copied,
								onPreview: () => openPreview(item), onCopy: () => copyPath(item), onReveal: () => reveal(item)
							})),
							items.length > limit ? React.createElement("button", {
								className: "dsp-more", type: "button", onClick: () => setLimit(limit + 120)
							}, T.showMore + " (" + (items.length - limit) + ")") : null,
							items.length > 400 ? React.createElement("div", { className: "dsp-row-meta", style: { textAlign: "center" } }, items.length + " " + T.tooMany + " 400") : null));
		}

		function ArtifactRow({ item, preview, copied, onPreview, onCopy, onReveal }) {
			const badge = item.ext !== "" ? item.ext.toUpperCase().slice(0, 4) : "FILE";
			const previewOpen = preview !== null && preview.path === item.path;
			const ops = item.source === "tool"
				? item.ops.slice(0, 3).map((op) => React.createElement("span", { key: op, className: "dsp-tag" }, op)).concat([
					item.changes > 1 ? React.createElement("span", { key: "n", className: "dsp-tag" }, item.changes + " " + T.changes) : null
				].filter(Boolean))
				: [];
			return React.createElement("div", { className: "dsp-row", "data-missing": item.exists === false ? "true" : "false", role: "listitem" },
				React.createElement("div", { className: "dsp-row-main" },
					React.createElement("div", { className: "dsp-row-icon", style: { background: kindColor(item) } }, badge),
					React.createElement("div", { style: { flex: 1, minWidth: 0 } },
						React.createElement("button", { className: "dsp-row-name", type: "button", onClick: onPreview, title: item.path, "aria-expanded": previewOpen ? "true" : "false" }, item.name),
						React.createElement("div", { className: "dsp-row-meta", title: item.path },
							humanSize(item.size) + (item.size !== null && item.size !== undefined ? " · " : "") + relTime(item.mtime) + " · " + item.relPath)),
					React.createElement("div", { className: "dsp-row-actions" },
						React.createElement("button", { className: "dsp-iconbtn", type: "button", title: copied === item.path ? T.copied : T.copyPath, "aria-label": T.copyPath + " " + item.name, onClick: onCopy }, copied === item.path ? "✓" : IconCopy),
						item.inside === true ? React.createElement("button", { className: "dsp-iconbtn", type: "button", title: T.reveal, "aria-label": T.reveal + " " + item.name, onClick: onReveal }, IconFolder) : null,
						item.inside === true && item.exists === true ? React.createElement("button", { className: "dsp-iconbtn", type: "button", title: T.preview, "aria-label": T.preview + " " + item.name, onClick: onPreview }, IconEye) : null)),
				React.createElement("div", { className: "dsp-tags" },
					ops,
					React.createElement("span", { key: "src", className: "dsp-tag" }, item.source === "tool" ? T.sourceTool : T.sourceScan),
					item.exists === false ? React.createElement("span", { key: "miss", className: "dsp-tag", "data-kind": "missing" }, T.missing) : null),
				previewOpen ? React.createElement(PreviewBody, { preview }) : null);
		}

		function PreviewBody({ preview }) {
			if (preview.loading) return React.createElement("div", { className: "dsp-preview" }, React.createElement("div", { className: "dsp-preview-note" }, T.syncing + "…"));
			const p = preview.payload;
			if (p === null || p.ok !== true) {
				const msg = p !== null && (p.error === "forbidden" || p.error === "symlink-escape") ? T.previewDenied
					: p !== null && p.error === "not-found" ? T.previewMissing
						: (p !== null && p.error ? p.error : T.loadFail);
				return React.createElement("div", { className: "dsp-preview" }, React.createElement("div", { className: "dsp-preview-error" }, msg));
			}
			return React.createElement("div", { className: "dsp-preview" },
				p.kind === "text"
					? React.createElement("pre", { tabIndex: 0 }, p.content)
					: p.kind === "image"
						? React.createElement("img", { src: p.dataUrl, alt: p.name })
						: React.createElement("div", { className: "dsp-preview-note" }, T.previewBinary + " · " + humanSize(p.size)),
				p.truncated === true ? React.createElement("div", { className: "dsp-preview-note" }, T.previewTruncated) : null);
		}

		// ── side chat view ────────────────────────────────────────────────────
		const chatStores = new Map(); // sessionId -> {state, subs:Set, loaded}

		function chatStoreOf(sessionId) {
			let store = chatStores.get(sessionId);
			if (store === undefined) {
				store = { state: chatInitial(), subs: new Set(), loaded: false };
				if (chatStores.size >= 12) chatStores.delete(chatStores.keys().next().value);
				chatStores.set(sessionId, store);
			}
			return store;
		}

		function chatDispatch(sessionId, action) {
			const store = chatStoreOf(sessionId);
			const next = chatReducer(store.state, action);
			if (next === store.state) return;
			store.state = next;
			for (const fn of store.subs) {
				try { fn(next); } catch (e) { /* isolated */ }
			}
		}

		function useChatState(sessionId) {
			const [state, setState] = React.useState(() => chatStoreOf(sessionId).state);
			React.useEffect(() => {
				const store = chatStoreOf(sessionId);
				setState(store.state);
				store.subs.add(setState);
				return () => store.subs.delete(setState);
			}, [sessionId]);
			return [state, (action) => chatDispatch(sessionId, action)];
		}

		function Markdownish({ text }) {
			if (Prim !== null && typeof Prim.MarkdownText === "function") {
				return React.createElement("div", { className: "dsp-msg-assistant dsp-md" },
					React.createElement(Prim.MarkdownText, null, text));
			}
			return React.createElement("div", { className: "dsp-msg-assistant" }, text);
		}

		function AssistantBubble({ text, interrupted }) {
			return React.createElement(React.Fragment, null,
				React.createElement(Markdownish, { text }),
				interrupted === true ? React.createElement("div", { className: "dsp-msg-meta" }, T.interrupted) : null);
		}

		function ChatView({ sessionId }) {
			const [state, dispatch] = useChatState(sessionId);
			const [draft, setDraft] = React.useState("");
			const [conn, setConn] = React.useState("connecting"); // connecting | open | lost
			const [meta, setMeta] = React.useState({ childId: null, model: null, provider: null });
			const [models, setModels] = React.useState([]); // [{id,label,provider}]
			const [modelsOpen, setModelsOpen] = React.useState(false);
			const [pickerError, setPickerError] = React.useState("");
			const scrollRef = React.useRef(null);
			const inputRef = React.useRef(null);
			const stickRef = React.useRef("follow"); // follow | pause
			const [stickUI, setStickUI] = React.useState("follow"); // render mirror of stickRef
			const stateRef = React.useRef(state);
			stateRef.current = state;

			// reconcile with the host on every mount (refresh, HMR, tab re-entry):
			// the child log is the source of truth for anything the SSE missed
			React.useEffect(() => {
				if (sessionId === undefined || sessionId === "") return;
				apiGet("/sidepanel/chat/state?sessionId=" + encodeURIComponent(sessionId))
					.then((res) => {
						setMeta({ childId: res.childId, model: res.model, provider: res.provider });
						const local = stateRef.current;
						const hostCount = (res.messages || []).length;
						const stale = local.phase === "streaming" && res.running !== true;
						if (local.messages.length === 0 || hostCount > local.messages.length || (stale && hostCount >= local.messages.length)) {
							dispatch({ type: "restore", messages: res.messages, running: res.running, partial: res.partial });
						}
					})
					.catch(() => {});
			}, [sessionId]);

			// live stream (SSE auto-reconnects)
			React.useEffect(() => {
				if (sessionId === undefined || sessionId === "") return;
				const es = new EventSource("/sidepanel/chat/stream?sessionId=" + encodeURIComponent(sessionId));
				es.onopen = () => setConn("open");
				es.onerror = () => setConn("lost");
				es.onmessage = (ev) => {
					let frame;
					try { frame = JSON.parse(ev.data); } catch (e) { return; }
					if (frame.type === "hello") {
						setConn("open");
						setMeta((m) => Object.assign({}, m, { childId: frame.childId }));
						if (frame.running === true && stateRef.current.phase === "idle" && typeof frame.partial === "string" && frame.partial !== "") {
							dispatch({ type: "restore", messages: stateRef.current.messages, running: true, partial: frame.partial });
						}
						return;
					}
					if (frame.type === "delta") dispatch({ type: "delta", text: frame.text });
					else if (frame.type === "assistant") dispatch({ type: "assistant", text: frame.text, interrupted: frame.interrupted });
					else if (frame.type === "turn") dispatch({ type: frame.state === "start" ? "turn-start" : "turn-end", reason: frame.reason });
				};
				return () => { es.close(); };
			}, [sessionId]);

			// available models: same source the main chat's picker uses
			React.useEffect(() => {
				let cancelled = false;
				apiGet("/sidepanel/chat/models")
					.then((res) => {
						if (cancelled) return;
						setModels(normalizeModelList(res));
						setPickerError("");
					})
					.catch((e) => {
						if (cancelled) return;
						setModels([]);
						setPickerError(e instanceof Error ? e.message : String(e));
					});
				return () => { cancelled = true; };
			}, []);

			// smart scroll: follow new content only while the user is at the
			// bottom; manual upward scroll pauses following until they come back
			const onScroll = () => {
				const el = scrollRef.current;
				if (el === null) return;
				const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
				const next = stickModeFor({ distanceFromBottom: distance, height: el.clientHeight, contentHeight: el.scrollHeight });
				stickRef.current = next;
				setStickUI((prev) => (prev === next ? prev : next));
			};
			React.useEffect(() => {
				const el = scrollRef.current;
				if (el === null) return;
				if (stickRef.current !== "follow") return; // user scrolled up: don't steal their position
				el.scrollTop = el.scrollHeight;
			}, [state.messages.length, state.partial]);

			// the streamed bubble is replaced by a full Markdown render when the
			// turn ends — that swap shrinks the content for a frame and then grows
			// it beyond the old height, so effect-driven scrolling alone leaves a
			// visible gap. While follow+streaming, a rAF loop re-pins every frame
			// (it self-stops when idle or paused, costing nothing at rest).
			React.useEffect(() => {
				const el = scrollRef.current;
				if (el === null) return;
				let raf = 0;
				const pin = () => {
					raf = 0;
					if (stickRef.current === "follow") el.scrollTop = el.scrollHeight;
					const active = stickRef.current === "follow" && (stateRef.current.phase === "streaming" || stateRef.current.phase === "stopping");
					if (active) raf = requestAnimationFrame(pin);
				};
				// start the loop on any turn activity; the first frame pins and
				// keeps itself alive while streaming
				raf = requestAnimationFrame(pin);
				return () => {
					if (raf !== 0) cancelAnimationFrame(raf);
				};
			}, [sessionId, state.messages.length, state.partial]);

			const send = (text) => {
				const trimmed = String(text || "").trim();
				if (trimmed === "" || stateRef.current.phase === "streaming" || stateRef.current.phase === "stopping") return;
				dispatch({ type: "send", text: trimmed });
				setDraft("");
				const chosen = pickStoredModel(panelStore.get().chatModel, panelStore.get()["chatModel." + (sessionId || "")]).effective;
				apiPost("/sidepanel/chat/send", { sessionId, text: trimmed, model: chosen })
					.catch((e) => dispatch({ type: "error", error: e instanceof Error ? e.message : String(e) }));
			};

			const stop = () => {
				dispatch({ type: "stop-requested" });
				apiPost("/sidepanel/chat/stop", { sessionId }).catch(() => {});
			};

			const retry = () => {
				let last = "";
				const msgs = stateRef.current.messages;
				for (let i = msgs.length - 1; i >= 0; i -= 1) {
					if (msgs[i].role === "user") { last = msgs[i].text; break; }
				}
				dispatch({ type: "retry" });
				if (last !== "") setTimeout(() => send(last), 0);
			};

			if (sessionId === undefined || sessionId === "") {
				return React.createElement("div", { className: "dsp-empty" },
					React.createElement("div", { className: "dsp-empty-title" }, T.noSession),
					React.createElement("div", { className: "dsp-empty-hint" }, T.noSessionHint));
			}

			const busy = state.phase === "streaming" || state.phase === "stopping";
			const phaseLabel = state.phase === "streaming" ? T.streaming : state.phase === "stopping" ? T.stopping : state.phase === "error" ? T.error : T.idle;
			// effective model chip: user pick wins over the inherited/current one
			const stored = pickStoredModel(panelStore.get().chatModel, panelStore.get()["chatModel." + (sessionId || "")]);
			const effectiveModel = stored.effective ?? meta.model ?? null;
			const inherited = stored.effective === null;
			// derive the retryable prompt from the transcript itself so replayed
			// history (restore resets lastUser) keeps the affordance
			let lastUserText = "";
			for (let i = state.messages.length - 1; i >= 0; i -= 1) {
				if (state.messages[i].role === "user") { lastUserText = state.messages[i].text; break; }
			}
			const lastMsg = state.messages[state.messages.length - 1];
			const retryable = !busy && lastUserText !== "" && (state.phase === "error" || lastMsg === undefined || lastMsg.role === "user" || (lastMsg.role === "assistant" && lastMsg.interrupted === true));

			return React.createElement("div", { className: "dsp-chat" },
				React.createElement("div", { className: "dsp-chat-scroll", ref: scrollRef, onScroll: onScroll },
					state.messages.length === 0 && state.partial === ""
						? React.createElement("div", { className: "dsp-chat-intro" }, T.chatIntro)
						: null,
					state.messages.map((msg, i) => msg.role === "user"
						? React.createElement("div", { key: i, className: "dsp-msg dsp-msg-user" }, msg.text)
						: React.createElement("div", { key: i, style: { display: "contents" } },
							React.createElement(Markdownish, { text: msg.text }),
							msg.interrupted === true ? React.createElement("div", { key: "m", className: "dsp-msg-meta" }, T.interrupted) : null)),
					state.partial !== ""
						? React.createElement("div", { className: "dsp-msg dsp-msg-assistant" },
							state.partial,
							React.createElement("span", { className: "dsp-caret" }))
						: null),
				stickUI === "pause" ? React.createElement("div", { className: "dsp-chat-jump-wrap" },
					React.createElement("button", {
						className: "dsp-chip dsp-jump", type: "button",
						onClick: () => {
							stickRef.current = "follow";
							setStickUI("follow");
							const el = scrollRef.current;
							if (el !== null) {
								el.scrollTop = el.scrollHeight;
								// programmatic scroll may not fire the scroll event in
								// the same frame — nudge the mirror state directly
								el.dispatchEvent(new Event("scroll"));
							}
						}
					}, T.jumpLatest)) : null,
				state.error !== "" ? React.createElement("div", { className: "dsp-chat-error" },
					React.createElement("span", null, state.error),
					lastUserText !== "" ? React.createElement("button", { type: "button", onClick: retry }, T.retryLast) : null) : null,
				retryable && state.error === "" ? React.createElement("div", { className: "dsp-chat-status", style: { justifyContent: "flex-start", cursor: "default" } },
					React.createElement("button", { className: "dsp-chip", type: "button", onClick: retry, style: { cursor: "pointer" } }, T.retryLast)) : null,
				React.createElement("div", { className: "dsp-chat-status", "data-phase": state.phase },
					React.createElement("span", { className: "dsp-chat-status-dot" }),
					React.createElement("span", { className: "dsp-chat-status-model" }, phaseLabel + (effectiveModel !== null && effectiveModel !== undefined ? " · " + T.model + " " + effectiveModel : "")),
					conn === "lost" ? React.createElement("span", { style: { color: "#b3422f", flex: "none" } }, "· " + T.connLost) : null),
				React.createElement("div", { className: "dsp-composer" },
					React.createElement("div", { className: "dsp-composer-row" },
					React.createElement("div", { className: "dsp-composer-side" },
						React.createElement("button", {
							className: "dsp-model-btn", type: "button",
							"aria-haspopup": "listbox", "aria-expanded": modelsOpen ? "true" : "false",
							title: inherited ? T.modelInherited : T.modelOverride,
							onClick: () => setModelsOpen(!modelsOpen)
						},
						React.createElement("span", { className: "dsp-model-dot", "data-inherited": inherited ? "true" : "false" }),
						React.createElement("span", { className: "dsp-model-name" }, effectiveModel ?? T.modelDefault),
						React.createElement("span", { className: "dsp-model-caret" }, "▾")),
						modelsOpen ? React.createElement("div", { className: "dsp-model-pop", role: "listbox", "aria-label": T.model },
							pickerError !== "" ? React.createElement("div", { className: "dsp-model-note" }, T.modelListFail + " " + pickerError) : null,
							React.createElement("button", {
								className: "dsp-model-item", type: "button", role: "option",
								"aria-selected": inherited ? "true" : "false",
								onClick: () => {
									setPanelModel(null);
									dispatch({ type: "model-pick", model: null });
									setModelsOpen(false);
								}
							}, React.createElement("span", { className: "dsp-model-check" }, inherited ? "✓" : ""), T.modelFollowMain),
							models.map((m) => React.createElement("button", {
								key: m.id, className: "dsp-model-item", type: "button", role: "option",
								"aria-selected": (!inherited && effectiveModel === m.id) ? "true" : "false",
								onClick: () => {
									setPanelModel(m.id);
									dispatch({ type: "model-pick", model: m.id });
									setModelsOpen(false);
								}
							}, React.createElement("span", { className: "dsp-model-check" }, (!inherited && effectiveModel === m.id) ? "✓" : ""), m.label)),
							models.length === 0 && pickerError === "" ? React.createElement("div", { className: "dsp-model-note" }, T.modelListEmpty) : null)
						: null)),
					React.createElement("div", { className: "dsp-composer-row" },
					React.createElement("textarea", {
						ref: inputRef, className: "dsp-input", rows: 2, value: draft,
						placeholder: T.chatPlaceholder, "aria-label": T.tabChat,
						onChange: (e) => setDraft(e.target.value),
						onKeyDown: (e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								send(draft);
							}
						}
					}),
					busy
						? React.createElement("button", { className: "dsp-stopbtn", type: "button", onClick: stop, disabled: state.phase === "stopping", "aria-label": T.stop },
							IconStop, state.phase === "stopping" ? T.stopping : T.stop)
						: React.createElement("button", { className: "dsp-send", type: "button", onClick: () => send(draft), disabled: draft.trim() === "", "aria-label": T.send }, T.send))));
		}

		// ── panel shell ───────────────────────────────────────────────────────
		function SidePanel({ useSessions }) {
			const [state, set] = usePanelState();
			const [mode, setMode] = React.useState("dock");
			const [artCount, setArtCount] = React.useState(null);
			const dragRef = React.useRef({ dragging: false, startX: 0, startW: 0 });
			const panelRef = useFrameTrack(state.open, state.width, setMode);

			const sessionId = typeof useSessions === "function" ? useSessions((s) => s.current) : undefined;
			const byId = typeof useSessions === "function" ? useSessions((s) => s.byId) : undefined;
			const sessionInfo = sessionId !== undefined && byId !== undefined ? byId[sessionId] : undefined;
			const title = sessionInfo !== undefined ? (sessionInfo.title || sessionInfo.displayTitle || "") : "";
			const running = sessionInfo !== undefined ? (sessionInfo.running === true || sessionInfo.status === "running") : false;

			React.useEffect(() => { setArtCount(null); }, [sessionId]);

			const onToggleScan = () => set({ includeScan: !state.includeScan });

			const onResizeDown = (e) => {
				e.preventDefault();
				e.currentTarget.setPointerCapture(e.pointerId);
				dragRef.current = { dragging: true, startX: e.clientX, startW: state.width };
				e.currentTarget.dataset.dragging = "true";
			};
			const onResizeMove = (e) => {
				if (!dragRef.current.dragging) return;
				const dx = dragRef.current.startX - e.clientX;
				set({ width: clampPanelWidth(dragRef.current.startW + dx) });
			};
			const onResizeUp = (e) => {
				dragRef.current.dragging = false;
				if (e.currentTarget.hasPointerCapture !== undefined && e.currentTarget.hasPointerCapture(e.pointerId)) {
					e.currentTarget.releasePointerCapture(e.pointerId);
				}
				e.currentTarget.dataset.dragging = "false";
			};
			const onResizeKey = (e) => {
				if (e.key === "ArrowLeft") { e.preventDefault(); set({ width: clampPanelWidth(state.width + 24) }); }
				else if (e.key === "ArrowRight") { e.preventDefault(); set({ width: clampPanelWidth(state.width - 24) }); }
			};

			const onPanelKeyDown = (e) => {
				if (e.key !== "Escape") return;
				const search = e.target !== null && e.target !== undefined && typeof e.target.closest === "function"
					? e.target.closest(".dsp-search") : null;
				if (search !== null) {
					// Esc inside the search box clears it (native value setter so
					// React's controlled input follows)
					if (search.value !== "") {
						const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
						setter.call(search, "");
						search.dispatchEvent(new Event("input", { bubbles: true }));
						e.preventDefault();
						e.stopPropagation();
					}
					return;
				}
				set({ open: false });
				if (toggleBtnEl !== null) toggleBtnEl.focus();
				e.preventDefault();
				e.stopPropagation();
			};

			if (!state.open) return null;

			const shortId = typeof sessionId === "string" ? sessionId.replace(/^session-/, "").slice(0, 8) : "";

			return React.createElement("aside", {
				ref: panelRef, className: "dsp-panel", "data-mode": mode,
				role: "complementary", "aria-label": T.panelName,
				onKeyDown: onPanelKeyDown
			},
				React.createElement("div", {
					className: "dsp-resizer", role: "separator", "aria-orientation": "vertical",
					"aria-label": T.widthHint, tabIndex: 0, title: T.widthHint,
					onPointerDown: onResizeDown, onPointerMove: onResizeMove,
					onPointerUp: onResizeUp, onPointerCancel: onResizeUp, onKeyDown: onResizeKey
				}),
				React.createElement("header", { className: "dsp-head" },
					React.createElement("div", { className: "dsp-head-row" },
						React.createElement("div", { className: "dsp-title", title: title !== "" ? title : (sessionId || "") },
							title !== "" ? title : (sessionId === undefined ? T.noSession : (sessionId || ""))),
						React.createElement("span", { className: "dsp-sync", "data-state": running ? "live" : "ok", title: T.session },
							React.createElement("span", { className: "dsp-sync-dot" }),
							running ? T.streaming : ""),
						React.createElement("button", {
							className: "dsp-iconbtn", type: "button", "aria-label": T.close, title: T.close + " (Esc)",
							onClick: () => { set({ open: false }); if (toggleBtnEl !== null) toggleBtnEl.focus(); }
						}, IconClose)),
					React.createElement("div", { className: "dsp-sub" },
						React.createElement("code", { title: sessionId || "" }, shortId === "" ? "—" : shortId))),
				React.createElement("div", { className: "dsp-tabs", role: "tablist" },
					React.createElement("button", {
						className: "dsp-tab", type: "button", role: "tab", "aria-selected": state.tab === "art" ? "true" : "false",
						onClick: () => set({ tab: "art" })
					}, T.tabArtifacts, artCount !== null ? React.createElement("span", { className: "dsp-tab-count" }, String(artCount)) : null),
					React.createElement("button", {
						className: "dsp-tab", type: "button", role: "tab", "aria-selected": state.tab === "chat" ? "true" : "false",
						onClick: () => set({ tab: "chat" })
					}, T.tabChat)),
				React.createElement("div", { className: "dsp-body" },
					state.tab === "art"
						? React.createElement(ArtifactsView, { sessionId, includeScan: state.includeScan, onCount: setArtCount, onToggleScan })
						: React.createElement(ChatView, { sessionId })));
		}

		// ── plugin apply ──────────────────────────────────────────────────────
		exports.inject = ["slots"];

		exports.apply = function apply(ctx) {
			ensureStyles();
			ensureFrameCss();
			try { watchMainChat(); } catch (e) { /* main-chat pin is best-effort */ }
			const slots = ctx.get("slots");
			if (slots === undefined) return;

			ctx.effect(() => slots.inject("conversation.session.header.utilities", () => {
				slots.register({
					name: "conversation.session.header.utilities", id: "sidepanel-toggle", order: 50
				}, ToggleButton);
			}), "dsh-sidepanel: header toggle");

			ctx.effect(() => slots.inject("shell.overlay", () => {
				slots.register({
					name: "shell.overlay", id: "sidepanel-panel", order: 10
				}, SidePanel);
			}), "dsh-sidepanel: panel");
		};

		return module.exports;
	}
});
