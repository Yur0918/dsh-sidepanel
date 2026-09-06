# CHANGELOG 1.4.0 — 两轮自检:双 P0 修复 + portal 架构下的 dock 挤压恢复 + 增量解码

日期:2026-09-05 · 范围:`lib/index.js` + `lib/client.js` + `scripts/install.mjs` · 来源:应用户要求的两轮自检(基于 1.3.7)

## 环境修复(本轮开始前,宿主级)

- **DSH 崩溃循环止损**:09-05 上午 `dsh-auto-update` 把核心升到 0.1.2-rc.1,profile 内 dshmarket 1.37.0 不兼容(`installSettingsSection` 导出被移除)→ 插件树加载失败 → KeepAlive 崩溃循环,root 页面 000。处置:pnpm 升级 dshmarket 至 1.41.0(恢复兼容);`dsh-market-tasks` 插件在 rc.1 下仍于启动路径抛 `sandboxPolicy in inactive context` fatal,已临时注释禁用(备份 `~/Backups/cordis.patch.yml.bak-20260905-sidepanel-selfcheck`),待其适配 rc.1 后恢复。
- **并发编辑冲突**:本轮编辑与外部 10:40 的修改撞车,产生 `scanCache` 重复声明(SyntaxError,同样导致宿主崩溃)——已去重,保留外部更完整的 `cachedWorkspaceScan`。

## 第一轮(正确性,2×P0 + 性能)

- **P0 客户端:模型选择器完全坏死**。1.3.x 引入的点击处理器调用了不存在的 `setPanelModel`,点击任何模型项抛 ReferenceError,弹层卡死。修复:点击写入 `panelStore` 的 `chatModel.<sessionId>` 键(`sanitizeState` 现在保留这些键,per-session 选择跨刷新持久化),`Follow main` 清除本会话覆盖回落全局。
- **P0 宿主:`ensureParentAgent` 的 unhandled rejection 可杀进程**。`pending.finally()` 派生的第二个 promise 在 resume 失败时无人处理,Node 默认行为是终止进程。修复:`pending.then(settle, settle)`。
- **P1 客户端:portal 架构下 dock 挤压整体失效**(1.3.x portal 改造的回归)。面板移到 body 级 host 后 `closest("[data-shell-overlay]")` 永远找不到 frame → apply 从不运行 → 网格从不加第四轨、拖宽失效、面板退化为纯覆盖。修复:frame 查找改为全局 `querySelector("[data-shell-overlay]")`(React 所有、文档唯一),恢复第四轨挤压、拖宽与详情把手补偿。
- **P1 宿主:会话日志全量重解码**。流式会话每 5s 轮询都整文件 zstd 解码 + 重折。重构 `foldSessionLog` 为 `createSessionFold / feedSessionText / finalizeSessionFold`,缓存解码字节边界,新数据只解码新帧并续折(openCalls 跨批保留);mismatch 判定也缓存(此前每个请求重读全日志)。
- **P1 宿主:`findSessionFile` 每请求全量走目录**(每 5s 轮询 O(项目数) 次目录读)。加 15s TTL 正缓存 + 4s 负缓存。
- **P1 客户端:拖宽每像素重建双 Observer + 同步写 localStorage**。`useFrameTrack` 的 width 改走 ref,拖拽中直接应用几何(零 React 渲染),pointerup 一次提交 store。
- **P1 客户端:中文 IME 按 Enter 误发送**。加 `isComposing` 守卫。

## 第二轮(健壮性 / UX)

- **SSE 重连对账**:`hello` 帧到达时拉取 `/chat/state` 对账,断线期间错过的事件不再永久缺失(此前仅挂载时对账一次)。
- **双 tab 常挂载**:切换标签不再卸载另一视图(聊天 SSE 与产物轮询保持存活,`hidden` 只切绘制)。
- **产物手动刷新按钮**(补需求缺口,`T.refresh` 此前从未被渲染);错误横幅在下次成功后自动清除;复制路径失败不再显示"已复制";预览响应按 path 丢弃过期竞态。
- **模型弹层 Esc 先关弹层**再关面板;聊天输入框 aria-label 用占位文案。
- **chatStores 驱逐跳过有订阅者的 store**(活跃会话不再被 FIFO 悄悄重置);`childAccum` 加 200 上限;`chatStop` await interrupt;SSE partial 增量加类型守卫;错误响应在 socket 已销毁时不再写。
- **`buildArtifacts` 按 abs 去重**(`a.txt` 与 `./a.txt` 不再产生重复行/重复 React key);chat 路径(ensureParentAgent/chatState)补 `mismatch` 拒绝;`chatState` 消除重复 `listChildren` IPC。
- **install.mjs**:symlink 与 patch 路径统一从 `DSH_HOME` 推导;悬空 symlink 自动修复;卸载改为结构驱动删块(不再依赖固定行数)。
- 死代码清理:`SidePanel` wrapper、`shouldAutoScroll`;补 `IconRefresh` 定义(1.3.7 引用但未定义)。

## 刻意不做(记录为已知项)

- sticky 重测量的 mutation 路径仍全量 `getBoundingClientRect`(滚动路径 1.3.7 已 O(1));待行级脏标记。
- `chatByParent` 写路径不重校验(同会话双面板可能各持缓存 child);低概率,观察。
- SSE 背压不处理(localhost 单用户);tablist 方向键导航未加。

## 验证

- 测试 28/28 全绿 + 新增 sanitizeState/chatModel.* 与 pickStoredModel 断言;`npm run check` 通过。
- 重启后真机 E2E 复测(见自检报告第二轮清单)。
