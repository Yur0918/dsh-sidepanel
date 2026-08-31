# dsh-sidepanel 1.1.0 自测记录(真实使用路径走查)

日期:2026-08-31 · 实例:http://127.0.0.1:3080(DSH launchd 常驻,kickstart 重启 4 次均自动恢复)
方式:HTTP API 实测(curl)+ 浏览器端到端(ego-browser 真实点击/DOM 探针)+ 子会话日志核对。
说明:该页面 `Page.captureScreenshot` 持续超时(DSH 1.0.0 交付时已知的页面特性),视觉证据以结构化 DOM 探针(getBoundingClientRect/computed style/aria 态/localStorage 快照)留档,关键数值可复测。

## 场景 1:打开侧边栏 → 选模型

| 步骤 | 操作 | 证据 | 结果 |
|---|---|---|---|
| 1 | 右上角工具区按钮打开面板 | `.dsp-iconbtn[aria-pressed]` true;panel dock 模式宽 280(可拖拽) | ✅ |
| 2 | 切到「侧聊」tab | composer 渲染完整:hasInput/hasSend/hasModelRow 全 true | ✅ |
| 3 | 点模型按钮 | aria-haspopup=listbox、aria-expanded 切换;弹层 240×280px 可见,位于按钮上方 | ✅ |
| 4 | 列表与主对话一致 | `/sidepanel/chat/models` 返回 4 组 21 模型(deepseek-official 3 / siliconflow 3 / openrouter 6 / zai-coding-cn 8),弹层 21 项,含 Free Models Router | ✅ |
| 5 | 当前模型标识 | 选中项 ✓ + aria-selected=true;"跟随主对话"默认选中;覆盖后按钮蓝色圆点/继承态灰点 + title 提示 | ✅ |
| 6 | 选「DeepSeek-V4-Flash」 | localStorage `chatModel = "deepseek-official/deepseek-v4-flash"`(修复双重前缀后实测值) | ✅ |

## 场景 2:发送消息 → 吸顶表现

| 步骤 | 操作 | 证据 | 结果 |
|---|---|---|---|
| 1 | 贴底状态发送「用 3 个字回答你是谁」 | 发送后距底 = 0px(atBottom true),新消息立即可见 | ✅ |
| 2 | 回复流式生成 | 增量期间保持贴底跟随(距底 ≤48px 窗口内 follow),无跳动 | ✅ |
| 3 | 手动上翻到顶(scrollTop=0,距底 1239px) | scrollTop 保持不动(旧版会被 delta 硬拽回底),不被抢滚动 | ✅ |
| 4 | 「回到最新」按钮出现 | `.dsp-jump` 可见,文案"回到最新" | ✅ |
| 5 | 点击按钮 | 距底 <48px(atBottom true),按钮消失 | ✅ |
| 6 | 手动滚回底部 | 距底回到窗口内自动恢复 follow | ✅ |

## 场景 3:切换模型真实生效

| 步骤 | 操作 | 证据(子会话日志 request/context) | 结果 |
|---|---|---|---|
| 1 | 发送带 `zai-coding-cn/GLM-5.3-Flash` | 新子会话 297ecf6c:provider=zai-coding-cn, model=GLM-5.3-Flash | ✅ 路由正确 |
| 2 | (该模型返回 429 每周/月额度上限,2026-09-03 重置) | 错误来自模型侧限流,非插件缺陷;turn-end 正常回写 | ✅ 优雅处理 |
| 3 | 发送带 `deepseek-official/deepseek-v4-pro` | 新子会话 d31f7a97:路由一致,回复「收到」 | ✅ 回复来自所选模型 |
| 4 | UI 选 flash 后发送 | 新子会话 474e4539:路由 `{"provider":"deepseek-official","model":"deepseek-v4-flash"}`,回复「小助手」 | ✅ |
| 5 | 不带 model 发送 | 沿用最近子会话路由(followup),回复正常 | ✅ 向后兼容 |
| 6 | 历史合并 | chat/state messages 11 条按子会话创建顺序排列,每条带 childId(128d7d4e→297ecf6c→d31f7a97→474e4539) | ✅ |

## 场景 4:重启后偏好保留

| 步骤 | 操作 | 证据 | 结果 |
|---|---|---|---|
| 1 | 整页刷新 | localStorage chatModel 保留;面板自动重开(dock, 464px);模型按钮仍显示 `deepseek-official/deepseek-v4-flash`,圆点=覆盖态 | ✅ |
| 2 | DSH kickstart 重启(共 4 次) | health `{ok:true, chat:true}`;面板/偏好/聊天回放全部自动恢复 | ✅ |
| 3 | 聊天历史跨重启回放 | 侧聊 8+ 条消息(含三个子会话)完整回放,中断标记保留 | ✅ |

## 场景 5:回归(原有功能不受影响)

| 检查 | 证据 | 结果 |
|---|---|---|
| 产物视图 | tab 切换正常,空态/列表渲染无 error(测试会话 items=0 显示空态;此前 1.0.0 验证的 92 条扫描路径未改动) | ✅ |
| 历史聊天回放 | 侧聊 msgs=8 渲染完整,Markdown 渲染路径未改动 | ✅ |
| 安装脚本 | symlink + cordis.patch.yml 插入行幂等,未改动 | ✅ |
| 宿主安全 | chat/send 仍校验 Sec-Fetch-Site;models 端点为只读 GET | ✅ |
| 单元测试 | 26/26 通过(新增 5 组:chatModel 清洗/stickModeFor/normalizeModelList 三形态/pickStoredModel/旧断言适配) | ✅ |
| 其他插件共存 | dsh-market、dsh-user-addons 未受影响(health ok;未改动其配置) | ✅ |

## 附:落档探针快照(节选)

- panel: `{mode:"dock", w:280, ariaLabel:"侧边面板"}`
- modelBtn: `{text:"deepseek-official/deepseek-v4-flash▾", hasPopup:"listbox", expanded:"false", title:"已指定模型，点击可更换"}`
- status: `空闲 · 模型 deepseek-official/deepseek-v4-flash`
- scroll: `{top:1239, total:1847, atBottom:true}`
- localStorage: `{open:true, width:464, tab:"chat", includeScan:false, chatModel:"deepseek-official/deepseek-v4-flash"}`
- 弹层: 21 项,首项「✓跟随主对话」,样本含 DeepSeek-V4-Flash/V4-Pro/Qwen3 8B (free)/DeepSeek R1 7B (free)/GLM-5.3 等

## 测试期间发现的缺陷与修复(全部当场修复并复测)

1. **模型 id 双重前缀**:宿主已拼 `provider/model`,客户端 groups 分支又拼一次 → `deepseek-official/deepseek-official/deepseek-v4-flash`。修复:客户端对含 `/` 的 id 不再加前缀;单测锁定两种形态。
2. **「回到最新」按钮不出现**:`stickRef` 是 ref,变化不触发渲染。修复:新增 `stickUI` render 镜像 state。
3. **点击按钮后不消失**:程序化 scrollTop 同帧不触发 scroll 事件。修复:点击处理器内显式 dispatchEvent 归位。
4. **旧测试断言过时**:sanitizeState 新字段导致 4 处期望缺 `chatModel:null`。修复并补新用例。

## 复测(审查修复后,21:00–21:10)

| 项 | 结果 |
|---|---|
| 路由判定(3 个真实 child 日志) | d31f7a97→v4-pro ✓ / 474e4539→v4-flash ✓ / 297ecf6c→GLM-5.3-Flash ✓,seq 判定全部正确 |
| 带模型发送 deepseek-v4-pro | 新 child 8ace0ce3 创建,ok=true |
| stop 全量打断 | 发送后立即 stop → {ok:true, stopped:true},无僵尸回合 |
| 单元测试 | 26/26 通过 |
| health | {ok:true, version:"1.1.0", chat:true} |

## 用户反馈修复(2026-08-31 21:23–21:50):「吸顶感觉没实现」

用户反馈吸顶功能没生效。80ms 粒度逐帧采样复现出真实缺陷:

**根因**:流式结束瞬间,partial 光标气泡被整段 Markdown 气泡替换 —— React 卸载+挂载之间内容高度先收缩后撑高,而自动滚动 effect 只在 text delta 时触发,Markdown 异步渲染的撑高无人跟随,视图停在旧位置(实测距底可达 444px),「回到最新」按钮无端出现。用户看到的就是「结束后视图不在底部」。

**修复**(lib/client.js ChatView):流式期间(follow+streaming/stopping)启动 rAF 逐帧贴底循环,每帧 `scrollTop=scrollHeight`;空闲/暂停时自动停止,零常驻开销。经三轮真实流式复测:

| 轮次 | 内容 | 逐帧 dist 统计 | 结论 |
|---|---|---|---|
| 修复前 | markdown 长文 | 结束后 dist=444px,jump 按钮滞留 | ❌ |
| 修复后第2轮 | 700字+表格 | 全程 gapFrames=0(采样 225 帧) | ✅ |
| 修复后第3轮(dist 专项) | 700字+表格 | 250 帧样本 min=0 max=0,over30=0 over100=0 | ✅ 全帧恒贴底 |

上翻暂停/快速上翻/小幅上翻/回到最新恢复 四个场景此前已 PASS,修复未影响(逻辑未动,仅贴底执行方式从 effect 改为 rAF 循环)。

## 主对话吸顶复测(2026-08-31 22:35)

用户澄清需求为主对话吸顶。三轮方案实测(JS scrollTop / defineProperty 拦截 / CSS sticky),最终 CSS sticky(flowItem 层)通过:

| 项 | 结果 |
|---|---|
| 长回复场景 top 序列 | 450→410→176→48→**8→8→8→8→8→8**(回复撑高行滑到顶钉住) |
| 短回复场景 | 行停在流区中间不钉(与 ChatGPT 一致的自然行为) |
| 用户上翻 | 行随滚动离开,原生 sticky 语义,无损回看 |
| 会话切换 | watcher 重臂,sticky 自动套到新会话最新行 |
| 单元测试 | 26/26 通过 |

## 吸顶堆叠修复复测(2026-08-31 23:00)

| 场景 | 结果 |
|---|---|
| 贴底 | count=1, top=8, 钉「里斯本」(最新条) ✓ |
| 滚到倒数第三条(重建缓存) | count=1, top=8 ✓ |
| 上翻 3000px | count=1, top=8, 正确切到「第四条」历史行 ✓ |
| 任意时刻钉住行数 | 恒为 1(不再堆叠) ✓ |
