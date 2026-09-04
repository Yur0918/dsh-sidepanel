# dsh-sidepanel

DSH(DeepSeek Harness)Web 的右侧边面板插件:给当前任务会话一个 Codex 风格的右侧栏,包含 **产物视图(Artifacts)** 与 **侧聊(Side chat)** 两个标签页。静态 profile 插件,随 DSH 启动自动加载,不改动任何核心代码。

- 产物视图:扫描会话日志(`~/.dsh/sessions/…/session.jsonl.zstd`,多帧 zstd),把该会话通过 `write` / `edit` / `str_replace_editor` 等工具生成或修改过的文件列出来(名称、类型、路径、大小、修改时间、来源、改动次数);支持搜索、来源筛选、复制路径、在访达中显示、文本/代码/Markdown/图片安全预览、可选的工作区 mtime 扫描(补齐 bash 创建的文件)。
- 侧聊:基于 DSH 原生 `subagents` 的 **fork** 续聊子会话——继承当前会话已完成轮次的上下文与模型,不写入主聊天转录;SSE 流式输出、停止、重试、中断标记、跨刷新/跨重启回放。子会话带 persona 约束,默认直接作答,不乱跑工具。
- 面板:右上角会话头工具区按钮开关;停靠模式通过在 `div.frame` 的 inline `grid-template-columns` 上追加第四轨挤压主界面(**不遮挡内容**),窄 viewport(<≈1.2k px)自动退化为带阴影的 overlay 模式;左侧边缘可拖拽调宽,也支持聚焦后 ←/→ 键盘调宽;Esc 关闭预览/清空搜索/收起面板并归还焦点;开关、宽度、标签页、扫描开关持久化在 localStorage,刷新后保持。

## 安装

前置:DSH 已按官方方式安装(`dsh web` 由 launchd `com.deepseek.dsh` 常驻,见 `~/.dsh/profiles/web/`)。

```bash
cd /Users/yur/Documents/Deepseek-harness/dsh-sidepanel
node scripts/install.mjs              # symlink 进 ~/.dsh/profiles/node_modules + 写入 cordis.patch.yml 插入行(幂等)
node scripts/install.mjs --restart    # 同上并 kickstart 重启 DSH 立即生效
# 验证
curl http://127.0.0.1:3080/sidepanel/health   # → {"ok":true,"addon":"dsh-sidepanel",...,"chat":true}
```

打开 `http://127.0.0.1:3080/`,进入任意会话,右上角会出现面板开关按钮。

## 启用 / 禁用 / 卸载

- **启用** = 安装状态(插入行存在 + symlink 存在)。
- **禁用**(保留代码与数据,不再加载):编辑 `~/.dsh/profiles/web/cordis.patch.yml`,删除或注释掉 `- insert:` 下的 `- id: sidepanel / name: dsh-sidepanel` 两行,然后 `launchctl kickstart -k gui/$(id -u)/com.deepseek.dsh`。
- **卸载**:`node scripts/install.mjs --uninstall`(移除插入行与 symlink 并重启)。已产生的侧聊子会话日志仍在 `~/.dsh/sessions/` 下,按普通会话数据对待即可。

## 工作原理

- **宿主半** `lib/index.js`:`inject:["webServer"]`,通过 `webServer.register({kind:"prefix",path:"/sidepanel"})` 挂同源路由(`/sidepanel/health|artifacts|file|reveal|chat/*`)。会话日志用 RFC 8878 帧解析逐帧 `zstdDecompressSync`;产物归属 = `tool/call`(`write`/`edit`/`str_replace_editor` 非 view 命令)与 `tool/result` 按 `callId` 配对,只计成功落盘的路径(失败调用标记 `ok:false`)。侧聊 = `ctx.subagents.startContinuable({provider:"fork", label:"sidepanel-chat", …})` 建续聊子会话,后续 `followup` 追加,`interrupt` 停止;`ctx.on("session/event")` 过滤子会话事件经 SSE 广播。父会话不在内存时用日志里最后的 `request/context` 模型 `agents.resume`。
- **客户端半** `lib/client.js`:`window.__ModuleLoader__.load` 工厂,注册 `conversation.session.header.utilities`(开关按钮)与 `shell.overlay`(面板本体)两个槽位。面板通过 MutationObserver + ResizeObserver 镜像 React 写入的三轨模板并追加第四轨,关闭时原样还原;详情见文件头注释。
- **状态**:面板偏好存 `localStorage["dsh-sidepanel.v1"]`;聊天转录以子会话日志为权威,刷新/重启后由 `/sidepanel/chat/state` 回放(按 header `seedLength` 切掉 fork 继承的父历史,只显示侧聊自己的对话)。

## 安全

- 预览/定位一律先做 `path.resolve` + 前缀包含检查(拒绝 `..` 穿越、cwd 外绝对路径),再做 `realpath` 双重包含检查(拒绝指向 cwd 外的符号链接——防符号链接逃逸)。
- 会话目录名与日志 header `id` 不一致时拒绝服务(`session-id-mismatch`)。
- 图片上限 8MB,文本预览上限 512KB(截断标注),扫描跳过 `node_modules`/`.git` 等重目录、深度/数量/单文件大小封顶。
- 变更类 POST(`chat/send`、`chat/stop`、`reveal`)校验 `Sec-Fetch-Site`(同源/none 放行),拦截跨站 CSRF 式驱动。
- sessionId 参数白名单正则,聊天文本 32KB 上限。

## 测试

```bash
node --test test/host.test.mjs test/safety.test.mjs test/client.test.mjs
```

22+ 用例覆盖:产物归属折叠(配对/去重/失败/视图命令跳过)、fork 边界切分(`seedLength`)、路径包含数学、真实文件系统上的预览安全(穿越/符号链接逃逸/缺失/ID 不匹配)、多帧 zstd、面板状态清洗与持久化、网格轨道计算(dock/overlay/closed)、聊天状态机(发送/增量/完成/停止/孤儿增量/错误/重试/回放)、槽位注册幂等。

## 排障

| 症状 | 处置 |
| --- | --- |
| 右上角没有按钮 | `curl /sidepanel/health`;404 → 插件没加载:检查 `~/.dsh/profiles/node_modules/dsh-sidepanel` symlink 与 `cordis.patch.yml` 插入行,然后 kickstart 重启;看 `/tmp/dsh.err.log` |
| 按钮在但面板不出现 | 打开浏览器控制台看 `[dsh-sidepanel]` 报错;确认当前在一个会话里(无会话时面板显示空态,不报错) |
| 产物列表为空 | 正常:该会话没用过 write/edit 类工具;可打开「工作区扫描」开关(按会话创建时间后的 mtime 启发式补齐 bash 产物) |
| 侧聊发送报错 | `/sidepanel/health` 的 `chat:false` = 当前 profile 缺 `agents`/`subagents` 服务;报 `session-not-found` = 会话日志不在 `~/.dsh/sessions`(桥派发会话在 `~/.dsh-routes/*/sessions`,也支持) |
| 侧聊一直转圈 | 模型侧慢/免费额度限流;子代理日志见 `~/.dsh/sessions/<ws>/session-*/…`(origin=subagent,label=sidepanel-chat);点停止后可用「重试上一条」 |
| 面板把主界面盖住了 | 仅在窄 viewport 下进入 overlay 模式(有意设计,保住 640px 中心区);加宽窗口即回到停靠挤压模式 |
| 想彻底重置 | 浏览器控制台 `localStorage.removeItem('dsh-sidepanel.v1')` 后刷新 |

## 已知限制

- 产物归属只看父会话自身的工具调用;子代理(含侧聊)产生的文件不归属父会话(可用工作区扫描补看)。
- bash 重定向创建的文件无法从日志精确归属,扫描来源是 mtime 启发式(会包含你在会话期间手动改过的文件),UI 用「扫描」标签区分。
- 侧聊 fork 只继承「已完成轮次」的上下文:主聊天正在生成时,侧聊看不到进行中的那一轮。
- `str_replace_editor` 的 `view`、`read`、`glob` 等读操作不算产物;`bash` 的 `rm` 不会把条目从列表移除(会标记「已删除」如果文件没了)。
- overlay 模式(窄屏)下面板会覆盖内容右侧,这是保留 DSH 中心区最小宽度的折中。
- 模型切换通过"新建子会话"实现(内核 followup 不可换模型):切换前的对话仍在,但旧子会话不能再续聊;正在流式时切换,旧回合会先完成或被中断。
- 模型目录来自内核 llm 服务实时构建,某 provider 离线时该组显示为失败占位,不影响其他组。

## 版本

1.3.6(2026-09-04):自检修复——死循环 blocker + 观察器治理 + 泄漏与宽度缓存——
- 修复审查发现的 blocker:chip 文案无条件写入 → 自己的 MutationObserver 捕获 childList mutation → 帧频自反馈死循环;改为 data-label 比对、仅真变化才写;空闲 1.2s 实测零 mutation。
- watchMainChat 单例 armed 句柄,重挂前先拆旧(observer/scroll/Resize);remount 分支重置 stickyExpandedEl 与 naturalH,不再持留游离 DOM;滚动器挂 ResizeObserver,中央列宽变化(dock/拖拽/缩放)即重测;补偿标记保存并还原宿主原 margin-top,sweepStaleComp 清扫 React 替换兄弟后的孤儿标记;pick 全量扫描不 early-break;首次滚动器未挂载改观察器等待;chip 文案接入 i18n;删死代码。
- 测试 28 项全过;详见 CHANGELOG-1.3.6.zh.md。

1.3.5(2026-09-03):滚回原位必展开 + 合并为单按钮——
- 修复:展开滞回阈值 top-60 对首行消息(top≈16)是负数,首行折叠后永不自动展开;补偿方案保证折叠/展开零位移,滞回带失去存在意义,折叠状态改为直接跟随钉住决策,回滚到消息自然位置必展开。
- 移除整个手动悬停折叠系统(折叠 ⌃ + fold-bar,约 200 行):它与钉住角标两套位置两套交互(左缘悬停 vs 右上常驻)观感割裂;只保留钉住行右上角一个「展开 ⌄ / 收起 ⌃」切换按钮,角标位置微调。
- 实测:st=0 完全展开、底部折叠钉住、往返正常、全程单角标;测试 28 项。详见 CHANGELOG-1.3.5.zh.md。

1.3.4(2026-09-03):修复钉住被 foldable 覆盖闪断 + 折叠补偿改挂下一兄弟 + 去掉整行白条——
- `.dsp-foldable{position:relative}` 与吸顶规则同特异性且靠后,长消息一旦可折叠 sticky 被覆盖成 relative(吸顶失效 + top:8px 对 relative 生效产生 8px 跳动 = 闪烁);改为 `:not(.dsp-main-sticky)`。
- 折叠从 clip-only 改为「真实压到 76px + 下一兄弟 margin-top 等量补偿」:布局总高不变,sticky 元素真正 strip 大小,可钉到会话底;关键教训——补偿不能放在 sticky 元素自身 margin(sticky 约束按 margin-box 计算,会吃掉等量可钉区间)。
- 折叠/展开 50px 滞回带防边界抖动;manualUnfolded 记忆手动展开;去掉钉住卡片 padding 位移。
- 去掉吸顶条横贯整行的白色横条:行级卡片背景/阴影删除,折叠条只保留气泡自身表面(--dsw-specific-bubble),渐隐改挂气泡列、渐入气泡色。
- 实测:全滚动区间钉住条 viewport top 恒定、零抖动、白条消失;测试 29 项。详见 CHANGELOG-1.3.4.zh.md。

1.3.3(2026-09-03):修复吸顶折叠在真实 DOM 从未生效——
- DSH 会话 UI 每条消息外包一层 `display:contents` 插槽壳(`data-slot=conversation.chat.node`),`flowItem.firstElementChild` 是这层壳,测高恒为 0:钉住长消息从不折叠、悬停「折叠 ⌃」从不出现(对所有会话失效,长提示词会话最显眼)。
- 新增 `pickBoxedChild` 穿透无盒包裹层找到真实内容盒,三处测高/取文本改走它;CSS 从 `> div:first-child` 改为 JS 管理的 `.dsp-pin-box` 后代选择器,折叠隐藏用 `display:none!important` 压过壳的内联样式。
- 真实页面 DOM 断言实测:【每日定时播报】942px 提示词钉住后折叠为 76px 紧凑条,展开/收起往返正常;短消息(82px)回归正常;测试 29 项。详见 CHANGELOG-1.3.3.zh.md。

1.3.0(2026-09-03):吸顶折叠 + 手动折叠 + 产物视图疏导——
- 钉住的用户消息超过 100px 时自动折叠成 76px 紧凑条(右上角「展开/收起」角标),长提示词不再把思考/回复内容整个盖住;clip-path 只裁视觉不动布局(sticky 元素用 max-height 会滚动跳位),不可见区点击穿透,展开态钉住行切换时自动复位。
- 历史长消息悬停出现「折叠 ⌃」,一键折成「首行 + 共 N 字」摘要条,点条任意处展开;与吸顶互斥(钉住行不显示折叠角标);视口上方的折叠/展开带 scrollTop 补偿;状态不持久化。
- 产物视图始终带工作区扫描(「工作区扫描」chip 不再被「含扫描来源」开关卡住);空状态明确区分「本会话没有文件工具产物」,并提供一键查看扫描结果。
- 纯函数 `stickyCollapseFor`/`foldSummary` + 测试 28 项;修复 npm test 脚本在 Node 22.22 下的写法。详见 CHANGELOG-1.3.0.zh.md。

1.1.0(2026-08-31):侧聊模型选择 + 吸顶体验优化——
- 侧聊模型选择:输入区上方模型按钮,列出与主对话同源的模型目录(llm 服务),当前模型高亮;"跟随主对话"恢复继承;选择持久化在 localStorage(dsh-sidepanel.v1 的 chatModel),刷新/重启宿主后保留。
- 切换即生效:发送时带所选模型;DSH 内核限制子会话模型在创建时固定(followup 不可换),因此换模型会自动开启一个新侧聊子会话(旧对话保留并按顺序回放合并显示)。
- 发送吸顶与智能滚动:发送后视图自动贴底;流式生成期间贴底跟随;手动上翻即暂停跟随(不再被硬拽回底部),出现"回到最新"悬浮按钮,点击或滚回底部恢复跟随。
- 新端点 GET /sidepanel/chat/models;POST chat/send 增 model 参数;chat/state 合并多子会话回放。
- 测试 26 项(新增模型目录归一化/吸顶判定/持久化清洗等 6 项)。

1.0.0(2026-08-31):首版——产物视图、侧聊(fork+SSE)、停靠/overlay 布局、持久化、测试与安装脚本。
