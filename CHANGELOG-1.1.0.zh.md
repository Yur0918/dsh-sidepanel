# dsh-sidepanel 1.1.0 变更说明与交接文档

日期:2026-08-31 · 变更范围:侧聊模型选择 + 发送吸顶/智能滚动 · 零内核改动,零依赖新增

## 一、改了什么(文件与位置)

### lib/index.js(宿主半)

| 位置 | 改动 |
|---|---|
| `VERSION` | 1.0.0 → 1.1.0;文件头路由清单加 `/chat/models` 与 send 的 model 说明 |
| `foldSessionLog()` — `request/context` 分支 | lastContext 记录 `seq`(事件序号),供子会话路由判定 |
| 新增 `parseModelId()` | 解析 `provider/model` 分组 id 与裸 model id |
| 新增 `currentChildRouting()` | 从子会话日志取其实际路由(lastContext.seq ≥ seedLength 才可信) |
| 新增 `buildModelCatalog()` | 调内核 `ctx.get("llm")` 的 `listProviders()` + `listModels()`,拼出与主对话同源的模型目录;单组失败不影响其余组 |
| `chatSend(parentId, text, model)` | 第三参 model:比较 currentChildRouting,路由不同 → `childId=null` 走新建子会话路径(agentOptions={provider,model});相同/未指定 → 原 followup;返回值带 childId+model;`chat/accepted` 广播带 model |
| 新增 `findSideChildren()` | 返回全部 sidepanel-chat 子会话(createdAt 序);`findSideChild` 改为其最新值(语义不变) |
| `chatState()` | 合并回放全部子会话的 own 消息(按创建顺序,多 child 时每条带 `childId`);返回值新增 `childModel`(当前生效模型) |
| 路由注册 | 新增 `GET /sidepanel/chat/models`;`POST /sidepanel/chat/send` 读取 body.model |

### lib/client.js(客户端半)

| 位置 | 改动 |
|---|---|
| `sanitizeState()` | 新增 `chatModel` 字段(string 或 null,trim 校验) |
| 新增 `stickModeFor()` / `shouldAutoScroll()` | 吸顶判定纯函数(距底 ≤48px follow,否则 pause;userPinned 强制 follow) |
| 新增 `normalizeModelList()` | 归一化模型目录:支持数组 / {models} / {groups:[{id,models}]} 三形态;宿主已扁平化的 id 不二次拼前缀 |
| 新增 `pickStoredModel()` | 全局/会话两级偏好解析(当前用全局 chatModel;会话级键位预留) |
| `chatReducer` | 新增 `model-pick` action;`restore` 携带 modelOverride |
| `ChatView` | 模型按钮+弹层(listbox,aria 全套);发送带 model;状态栏显示 effectiveModel;新增 stickUI 渲染镜像 state(ref 变化不触发渲染,故镜像);onScroll 更新 stick;`回到最新`悬浮按钮(stickUI==="pause" 时出现) |
| composer 结构 | 纵向两行:第一行模型选择器,第二行输入框+按钮(`dsp-composer-row`) |
| CSS | 新增 `.dsp-model-btn/.dsp-model-pop/.dsp-model-item/.dsp-model-dot/.dsp-chat-jump-wrap/.dsp-jump` 等;`.dsp-chat` 加 `position:relative` 承载悬浮按钮 |
| i18n | 中英各加 9 条(modelDefault/modelFollowMain/modelInherited/modelOverride/modelListFail/modelListEmpty/jumpLatest/chatIntro 等) |

### test/client.test.mjs

- 旧断言适配 `chatModel` 字段(4 处)
- 新增 5 组用例:sanitizeState 的 chatModel 清洗、stickModeFor 判定、normalizeModelList 三形态(含宿主已扁平化 id 不二次前缀)、pickStoredModel 优先级
- **26/26 通过**(`npm test`)

### package.json / README.zh.md / UX-SUGGESTIONS.zh.md

- 版本 1.1.0;README 版本段+已知限制;建议清单为新增文件

## 二、新增配置项与数据

| 项 | 位置 | 语义 |
|---|---|---|
| `chatModel` | localStorage `dsh-sidepanel.v1` | 侧聊模型覆盖,null=跟随主对话;值为模型目录的扁平 id(如 `deepseek-official/deepseek-v4-pro`) |
| GET `/sidepanel/chat/models` | 宿主路由 | `{ok, groups:[{id,name,models:[{id,model,label,provider}],failure?}]}` |
| POST `/sidepanel/chat/send` | 宿主路由 | body 新增可选 `model`;响应 `{ok, childId, model}` |
| GET `/sidepanel/chat/state` | 宿主路由 | 响应新增 `childModel`;多子会话时 messages 每条带 `childId` |

## 三、工作原理(关键机制)

1. **模型目录**:内核 `llm` 服务实时构建(与主对话选择器同源),宿主半直接 `ctx.get("llm")`,无 HTTP 中转。
2. **切换生效**:DSH 内核在子会话创建时把 provider/model 快照进持久化 descriptor,`followup` 不可换模型(源码核实:continuation.d.ts:119-124)。因此"发送时发现所选路由 ≠ 当前子会话路由"即新建 fork 子会话;旧子会话日志保留。
3. **历史合并**:`chatState` 按 createdAt 顺序合并所有 sidepanel-chat 子会话的 own 消息(seedLength 切掉 fork 继承的父历史),刷新/重启后回放完整。
4. **吸顶**:`stickModeFor` 纯函数判定;贴底(≤48px)时每个 delta 跟随;上翻即 pause;程序化滚动同帧不触发 scroll 事件的浏览器行为,用显式 dispatchEvent 归位 mirror state。

## 三点五、反方审查修复(2026-08-31 21:05)

外派审查 Agent 超时,由主线按同一攻击清单(a–g)自查,发现并修复 2 个 P1:
1. `lastContext` 缺 `seq` 字段(编辑遗漏)→ currentChildRouting 恒判"非自己的 turn",每次发送都新建子会话(过度轮换)。已补 seq 并用 3 个真实 child 日志复测判定全部正确。
2. `chatStop` 只打断最新 child → 切模型轮换下来的旧 child 若在流式会后台继续跑(僵尸回合)。已改为打断全部在跑的 sidepanel-chat child。
详见 /Users/yur/Documents/Autoclaw/.cluster/dsh-sidepanel-model/review.md。

## 四、验证结果(全部实测)

- 单测 26/26 通过(`npm run check` 语法 + `npm test`)
- 真实实例 http://127.0.0.1:3080(DSH kickstart 重启加载):
  - `/sidepanel/chat/models`:4 组 21 模型,含 Free Models Router(openrouter/free)
  - 发送带 `zai-coding-cn/GLM-5.3-Flash` → 子会话 297ecf6c 日志路由一致(该模型返回 429 额度上限,为模型侧限流非插件缺陷)
  - 发送带 `deepseek-official/deepseek-v4-pro` → 子会话 d31f7a97 回复"收到",路由 `{"provider":"deepseek-official","model":"deepseek-v4-pro"}`
  - UI 选 `deepseek-v4-flash` 后发送 → 子会话 474e4539 路由一致,回复"小助手"
  - 不带 model 发送 → 沿用最近路由(v4-pro),回复正常
  - 多子会话回放:messages 11 条按序合并,每条带 childId
  - 吸顶:发送后 atBottom=true;上翻 scrollTop 保持;回到最新按钮出现/消失/回底全部 PASS
  - 持久化:刷新后按钮仍显示所选模型;localStorage 值 `deepseek-official/deepseek-v4-flash`
  - 回归:产物 tab 渲染正常(rows/empty/无 error)、历史聊天回放完整、宿主重启后自动恢复

## 四点五、用户反馈修复(2026-08-31 21:50)

用户反馈「吸顶感觉没实现」。复现确认真实缺陷:流式结束瞬间 partial→整段 Markdown 的 React 卸载/挂载两帧间隙里,Markdown 异步渲染撑高内容,而自动滚动只在 text delta 时触发 → 视图停在旧位置(实测距底 444px)。修复:流式期间改为 rAF 逐帧贴底循环(空闲自动停止)。修复后逐帧采样 dist 恒为 0(250 帧零偏差)。

## 五、已知限制

1. 切换模型=新建子会话(内核限制):旧子会话不可再续聊(其上下文延续由新子会话的 fork 种子承担——新子会话仍继承父会话全部已完成轮次,但旧侧聊里的问答不进新子会话上下文)。
2. 模型目录是 advisory 数据:某 provider 离线时该组显示失败占位。
3. `Page.captureScreenshot` 在该页持续超时(DSH 页面特性,1.0.0 已知),视觉证据以 DOM 结构探针(rect/computed style/aria 态)留档。
4. 会话级模型偏好(`chatModel.<sessionId>`)的 UI 入口未开放,当前为全局偏好。

## 六、回滚

- `git`/文件级:恢复 lib/index.js、lib/client.js、package.json、README.zh.md 到 1.0.0,kickstart 重启即可。
- 功能级:用户不点模型按钮(保持"跟随主对话")即等价 1.0.0 行为。
- 彻底卸载:`node scripts/install.mjs --uninstall`(不变)。

## 六、主对话「发送吸顶」(2026-08-31 21:55–22:35,用户反馈补充)

用户澄清需求:吸顶指**主对话**里发送的消息应钉在视口顶部(ChatGPT 式),而非侧聊贴底。

**方案演进**(三个方案实测后定稿):
1. ❌ JS 写 scrollTop(视口差值两段式)——内核 ChatView.followRef 在每个 assistant delta 后调 toBottom 重写 scrollTop,写入被每帧覆盖,实测无法稳定钉住(连续 5 个方案变体均被覆盖)。
2. ❌ 实例级 scrollTop defineProperty 拦截——内核模块加载时缓存了原型 setter 引用,实例覆写拦不住。
3. ✅ **CSS position:sticky**(最终方案):给最新一条用户消息的滚动内容块(`flowItem`)加 sticky 类,`top:8px`。浏览器原生把它钉在视口顶——回复撑高把行"推"过顶线时自动钉住,内核随便怎么滚动都不冲突,零 JS 滚动写入。

**实现**:
- `lib/client.js` 新增 `mainChatRows()/mainChatApplySticky()` 与 `watchMainChat()`:MutationObserver 监听 `[data-conversation-scroll]`,任何变化(新消息、回复 delta、会话切换)都把 sticky 类重新套到最新用户行的 flowItem 上;会话重挂载时自动重臂。
- CSS:`[class*="flowItem"].dsp-main-sticky{position:sticky;top:8px;z-index:5}` + 用户气泡白底圆角(钉住时不透出下层)。
- 行为:发送 → 回复流式撑高 → 问题行滑到视口顶 8px 钉住(实测 top 序列 450→410→176→48→8→8→8…),回答在问题下方滚动;用户上翻时行随滚动离开(浏览器原生 sticky 语义),无损回看。
- 单测 26/26 保持通过。

**已知边界**:最后一条消息的回复很短时(行未被推过顶线),行停在流区中间(不钉)——与 ChatGPT 行为一致;行钉住期间用户滚轮向上即正常离开。

## 七、吸顶堆叠修复(2026-08-31 22:49,用户截图反馈)

用户截图:向上翻历史时两条消息气泡叠在一起。

**根因**:所有 userRow 都 sticky 时,向上滚动多条行同时满足钉住条件,全部叠在 top:8px(CSS sticky 在全高包含块下不会互相推挤)。

**修复**:改为**滚动驱动的单行吸顶**——
- MutationObserver 变化时(新消息/回复撑高)用 sticky 类全部摘除后测量各行自然文档位置并缓存;
- scroll 事件(40px 内无 reflow)从缓存挑「最后一条自然位置越过顶线」的行,单独挂 sticky 类;
- 任意时刻最多一条钉住;上翻历史时钉住行逐条切换(实测 3000px 上翻正确从最新条切到历史行);
- 会话重挂载自动重建缓存。
