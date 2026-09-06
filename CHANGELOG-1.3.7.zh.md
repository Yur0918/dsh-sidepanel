# CHANGELOG 1.3.7 — 两轮自检:补偿回收 blocker + 滚动路径布局读 + 扫描轮询缓存

日期:2026-09-05 · 范围:`lib/client.js` + `lib/index.js` · 来源:应用户要求的两轮自检

## 第一轮(性能)

- **宿主:工作区扫描 30s TTL 缓存**。产物面板每 5s 静默轮询,此前每次都全量走工作区
  目录树(上限 4000 目录/300 文件,node_modules 等已在跳过表)。现在原始扫描结果缓存
  30 秒,每次调用只按当前工具产出清单重新过滤(`cachedWorkspaceScan`)。
- **客户端:滚动路径去掉逐行强制布局读**。`mainChatApplySticky` 的逐行 pass 原本每次
  滚动都对每条未折叠行执行 `getBoundingClientRect` 刷新 naturalH;行高只会在内容
  mutation / 宽度变化时改变,而两者都经由 `schedule → measureStickyRows` 统一刷新。
  滚动路径现在只对未缓存的新行读一次高度,稳态滚动 O(1) 布局读。

## 第二轮(正确性,blocker)

- **rest-comp 补偿标记状态机断裂:展开后补偿 margin 永不回收**。`applyRestComp` 把
  兄弟节点原 margin 存进 `data-dsp-rest-comp` 后从不写入 `"1"`,而 `clearRestComp`
  只在标记等于 `"1"` 时恢复——结果:钉住的长消息滚过顶线后,压在下一行上的
  `(natural − 76)px` margin 永久滞留(942px 的播报消息 = 866px 永久空白;
  sweep 仅在其他行折叠时顺带恢复,单折叠行会话永远轮不到)。修复:去掉多余的
  `"1"` 状态,标记「存在 = 原值已存」,apply 不覆盖已存原值、clear/sweep 按存在性
  恢复,三处语义对齐。

## 验证

- 测试 28/28 全绿,`npm run check` 通过;重启后真机复测钉住/滚过/回滚无残留空白。
