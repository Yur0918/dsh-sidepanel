# dsh-sidepanel 交付与优化报告

日期:2026-08-31 · 版本 1.0.0 · 目标实例 http://127.0.0.1:3080/(DSH 0.1.1-rc 系列,launchd `com.deepseek.dsh` 常驻)

## 1. 用户路径与需求落点

以普通使用者视角梳理的真实使用路径:**在 DSH 里干活的用户,想在不动主对话的情况下 (a) 一眼看到这个会话"产出了哪些文件"并快速预览/定位;(b) 就当前任务问点小问题(继承上下文但别污染主聊天)**。这正是 Codex 右侧面板的核心体验。

| 需求 | 落点 |
| --- | --- |
| 右上角工具区按钮、风格一致 | `conversation.session.header.utilities` 槽位列表项(id `sidepanel-toggle`,order 50),内联 SVG 图标匹配 DSH 描边风格,`aria-pressed` 状态 |
| 不遮挡主界面 | 停靠模式:`MutationObserver`+`ResizeObserver` 镜像 React 写入的三轨 `grid-template-columns` 并追加第四轨;中心区保留 DSH 契约的 640px 下限;详情列拖拽把手用 CSS `transform` 按 `--sp-track` 补偿 |
| 宽度拖拽/持久化 | 面板左缘 separator(指针捕获拖拽 + `tabIndex` + ←/→ 键盘);`localStorage["dsh-sidepanel.v1"]` 保存 open/width/tab/includeScan |
| 产物:仅本会话生成/修改 | 宿主折开会话日志(多帧 zstd),`tool/call`(write/edit/str_replace_editor 非 view)与 `tool/result` 按 `callId` 配对,失败调用标记不计数;显示名称/类型/路径/大小/mtime/来源/改动次数/已删除标记 |
| 刷新、搜索/筛选、复制、定位、预览 | 5s 自动轮询(页面可见时)+ 手动刷新路径;搜索框匹配名称/路径/扩展名/种类;来源筛选(全部/工具产出/工作区扫描);`writeClipboard` 复制;`open -R` 访达定位;文本(512KB 截断)/图片(8MB,dataURL)/二进制(仅元信息)预览,SVG 按文本处理防脚本 |
| 加载态/空态/错误态 | 三态齐备(骨架文案/空态区分"无产物"与"无匹配"/错误横幅带重试) |
| 路径安全 | `path.resolve`+前缀包含 → `realpath` 二次包含(符号链接逃逸拒绝)→ 会话 id 与日志 header 一致性校验;单测含真实 symlink 逃逸用例;`Sec-Fetch-Site` 校验拦截跨站 POST |
| 侧聊:先验证可复用接口 | 实证了 `session.prompt`/`session.cancel`(主聊天通道,会写主转录,弃用)与 `subagents.startContinuable/followup/interrupt`(fork 续聊子会话,**采用**:继承已完成轮次上下文、独立日志、不进主转录);SSE 通道自建在 `/sidepanel/chat/stream` |
| 侧聊:继承模型/权限/上下文 | fork 种子=父会话已完成轮次;`agentOptions` 取 live agent 或日志最后 `request/context`;子会话与父同 harness 权限域;persona 约束默认直答不乱用工具 |
| 流式/停止/重试/渲染 | SSE `text-delta` 增量 + 光标动画;停止=`interrupt`(authority user);重试=drop 尾部交换重发;assistant 文本走内核 `MarkdownText`(不可用时降级 pre-wrap);中断标记跨重启回放 |
| 面板收起/切换保持状态 | 聊天 store 按会话 id 存模块级 Map(上限 12),收起/切 tab 不丢;刷新/重启由宿主子会话日志回放(`seedLength` 切掉 fork 继承的父历史) |
| 不干扰主聊天 | 主聊天零污染实测(面板外 0 个新气泡);fork 子会话只出现在子代理目录,不在主转录 |
| 自启动 | 静态 profile 插件(symlink+cordis.patch.yml 插入行),进程级 launchd + 插件级 profile 双层;DSH 重启 4 次(N 轮修复)均自动恢复,无手工命令 |
| 幂等安装 | `scripts/install.mjs` 重复执行跳过已完成步骤;槽位注册按 id 替换;失败不影响主功能(宿主半 try/catch 降级、客户端半槽位注册相互隔离) |
| 键盘可达/Esc/窄屏/长文件名 | 按钮/输入/separator 均可聚焦,Esc 三级(关预览→清搜索→收起面板并还焦点给开关);窄屏 overlay 模式实测;92 条列表零横向溢出 |

## 2. 架构选择与理由

- **独立包 `dsh-sidepanel`** 而非并入 dsh-user-addons:独立清单/测试/卸载路径,禁用=删两行,回滚零残留;与现有插件共存无冲突(`/sidepanel` vs `/addons` 前缀)。
- **产物来源=日志折算而非文件系统**:会话日志是"谁改了什么"的唯一权威;mtime 扫描只作可选补充(bash 产物),UI 用来源标签区分事实与启发式。
- **侧聊=fork 子会话而非复用主会话**:共享会话会写主转录(实测确认);`inject()` 只进上下文不产生回复;fork 是官方提供的"继承上下文的旁路会话",恰好是侧词语义。
- **SSE 而非复用 events.mux**:mux 是内核私有协议且按会话订阅主事件流;侧聊需要跨会话(child)→面板(parent)的自有广播,SSE 走自己的 webServer 前缀,零内核耦合。
- **网格改写而非 CSS 覆盖**:React 拥有 inline style,`!important` 覆盖会与列宽求解器打架;镜像+追加是可逆、可观测的(关闭时还原 React 原值)。

## 3. 实际改动文件

- 新增包 `/Users/yur/Documents/Deepseek-harness/dsh-sidepanel/`:`package.json`(dsh 插件清单)、`lib/index.js`(宿主半,~990 行)、`lib/client.js`(客户端半,~1050 行)、`test/{host,safety,client}.test.mjs`(22 用例)、`scripts/install.mjs`(幂等装/卸)、`README.md`/`README.zh.md`/`LICENSE`、本报告。
- 环境注册:`~/.dsh/profiles/node_modules/dsh-sidepanel`(symlink)、`~/.dsh/profiles/web/cordis.patch.yml`(+5 行注释与插入行)。
- **零核心改动**;DSH 重启多次,未动 `~/.dsh/settings.yaml`、dsh-user-addons、dshmarket。

## 4. 验证证据(全部实测,非模拟)

**单元测试 22/22 通过**(产物归属配对/失败/视图跳过、seedLength 边界、包含数学、真实 fs 的穿越/符号链接逃逸/ID 不匹配、多帧 zstd、状态清洗、轨道计算、聊天状态机全路径、槽位幂等)。

**浏览器端到端(ego-browser,真实实例)**:
- 开关按钮渲染与 `aria-pressed`;面板 dock 模式网格 `280px minmax(0px,1fr) 0px 464px`(四轨);键盘 ←(380→404)与拖拽(+60→464)并持久化。
- 产物:真实会话行(settings.yaml,edit×2,工具标签)、cwd 外文件仅复制按钮(安全边界)、预览开关、无匹配空态、扫描开关 92 条(80 上限+显示更多→92)、零横向溢出。
- 预览安全(curl 实测):`dsh-user-addons/README.md` 文本 200;`../../.ssh/id_ed25519` → `forbidden`。
- 侧聊:两次真实模型对话(SSE 帧 hello/turn/delta"收到"/assistant/turn-end 全捕获);长文生成中点击停止→idle+「已中断」;重试按钮→重发→streaming→完成(1225 字);主聊天污染检查 0;persona 生效(新子会话直答不跑工具)。
- 持久化:整页刷新后面板自动开/宽度 464/标签保持/聊天 4 条回放;DSH kickstart 重启后同样自动恢复(多次)。
- 会话切换:新建会话→面板重绑(标题/短 id/空产物/侧聊重置为 intro)。
- 回归:dsh-user-addons 用量胶囊、拖拽上传 dock、设置入口、根页面全部正常;卸载往返中 `/addons` 始终 200。
- 卸载/重装往返:`--uninstall` 后 root 200、`/sidepanel` 404、patch 文件无损;重装后 health 恢复 `chat:true`。

**已知未验证项**:主聊天发送一条真实消息(避免向用户真实会话注入测试内容,回归以 UI 结构+既有插件面为准);`Page.captureScreenshot` 在该页持续超时,视觉证据以 DOM/computed-style 探针代替;聊天"网络错误横幅"路径仅单测覆盖(未注入真实网络故障)。

## 5. 开发中实际修复的缺陷(过程记录)

1. cordis `ctx.effect(fn)` 立即执行 fn 并取返回值为清理函数——初版把清理写成立即执行,路由注册即被自毁(404/405 落入静态兜底);改为返回清理函数。
2. React 实际网格模板是 `minmax(0px, 1fr)`,正则按 `minmax(0, 1fr)` 写死导致永远 overlay;正则放宽两种写法。
3. fork 会把父历史的 `session/end-seed` 一并复制,按 end-seed 切分错误;改按 header `seedLength` 与事件 seq 切分。
4. compaction 会追加 end-seed,取"最后一次"会切掉早期自有对话(已随 3 一并解决)。
5. 回放重置 `lastUser` 导致中断后重试按钮消失;重试语义改为从转录推导。
6. 空文本被中断的 assistant 消息回放丢失标记;折叠时保留(空文本+interrupted)。
7. 侧聊子会话无 persona 时把一句寒暄当任务跑了 11 轮工具;加 persona 约束后直答。
8. 「工作区扫描」开关与筛选器重名引发误触;开关改名「含扫描来源」。
9. 卸载脚本少跳一行留下孤儿 `name:` 行污染 dsh-market 配置块导致 DSH 启动失败(已当场修复 yml 并救回服务,脚本改为跳 5 行块 + 尾部规范化,往返复测通过)。

## 6. 已知限制

见 README.zh.md「已知限制」:产物归属不含子代理文件、bash 产物靠 mtime 启发式、fork 只继承已完成轮次、读操作不算产物、窄屏 overlay 会覆盖右侧。

## 7. 回滚

- 禁用:`~/.dsh/profiles/web/cordis.patch.yml` 删 sidepanel 插入行 + kickstart。
- 卸载:`node scripts/install.mjs --uninstall`(移除行+symlink+重启,已实测)。
- 数据残留:侧聊子会话日志(origin=subagent,label=sidepanel-chat)留在 `~/.dsh/sessions/`,按普通会话数据处理;浏览器 `localStorage['dsh-sidepanel.v1']`。
