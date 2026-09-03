# CHANGELOG 1.3.4 — 修复:钉住被 foldable 规则覆盖闪断 + 折叠补偿改挂下一兄弟 + 去掉整行白条

日期:2026-09-03 · 范围:`lib/client.js`(CSS + 吸顶状态机)+ `lib/index.js`(版本号)· 零内核改动

## 背景

1.3.3 修复折叠失效后,真实使用反馈两个新症状:
1. **向下滑动会话一直闪**;
2. **消息太长时反而不吸顶**。

## 根因 1(闪断主凶):`.dsp-foldable` 的 `position:relative` 覆盖了 `position:sticky`

`.dsp-foldable{position:relative}`(为悬停「折叠 ⌃」角标提供定位锚)与
`.dsp-main-sticky{position:sticky;top:8px}` 特异性相同、且在样式表中靠后——
长消息一旦 foldable,sticky 被静默覆盖成 relative(实测计算样式 `pinPos:"relative"`),
吸顶完全失效;而 `top:8px` 对 relative 同样生效,行被平移 8px,类切换时整行上下跳。
短消息不可折叠,反而正常吸顶——与"消息太长才不吸顶"的现象完全吻合。

修复:`.dsp-foldable:not(.dsp-main-sticky){position:relative}`——钉住行保持 sticky
(它本身就是 positioned,角标定位不受影响)。

## 根因 2(钉住区间被吃掉):折叠裁剪不减少布局高度,sticky 元素被容器底边推出

clip-path 只裁视觉,钉住元素在文档流里仍是 942px;sticky 要求元素留在容器底边之内,
会话剩余内容越短,可钉区间越小,长消息大半路程都在"被推出"状态。

修复:折叠时把真实内容盒压到 76px(`height + overflow:hidden`),把省下的高度以
**下一兄弟节点的 `margin-top`** 补回(`data-dsp-rest-comp` 标记,幂等重挂)——布局总高
不变、下方内容零跳动、sticky 元素真正只有 76px,可一路钉到会话底。

**关键教训:补偿不能放在 sticky 元素自身的 `margin-bottom` 上**——sticky 约束按元素
的 margin-box 装进容器计算,自身 866px margin 会吃掉 866px 可钉区间,钉住条会在
会话中段被冻结后随内容滑走(实测 frozen at 同一 scroll 坐标)。1.3.3 末版曾犯此错。

其余配套:
- 折叠/展开加 50px 滞回带(收起阈值 top-10,展开回差 top-60),滚动动量/回弹在边界
  抖动时不再反复改布局;
- `manualUnfolded` WeakSet:用户用「折叠 ⌃」手动展开过的行不被自动折叠立刻压回去;
- measure 只剥 sticky 类、不剥折叠类(补偿保证几何不变,剥了反而丢滞回状态);
- 去掉钉住卡片的 `padding:2px 4px`(钉住/取消钉住之间存在 4px 位移)。

## 视觉:去掉吸顶条横贯整行的白色横条

1.3.3 给 `.dsp-pin-box`(整行 748px)加了 `background + box-shadow`,而气泡只有右侧
525px 宽(右对齐)——视觉上是一条横贯整行的白条。修复:删除行级卡片样式,折叠条只
保留气泡自身表面(`--dsw-specific-bubble`,浅色模式淡蓝/深色模式自适应);底部 30px
渐隐改挂在气泡列(`> [class*="userStack"]`)上、渐隐到气泡色。

## 实测验证(127.0.0.1:3080,真实页面 DOM 断言)

【每日定时播报 · DSH 插件市 会话,全滚动区间 8 档采样 ×4:

- 钉住条 viewport top **恒定 84px**(滚动容器顶 + 8),从第一档到最大滚动量 2637 全程
  不脱离——尾部推出的旧症状消失;状态零抖动(flapCount 0);
- 折叠条背景透明(白条消失),高度 76px,补偿 margin 866px 挂在下一兄弟;
- 「展开 ⌄ ⇄ 收起 ⌃」往返:展开态 942px/补偿清除、收起态 76px/补偿挂载,均正确;
- 测试 29 项全过。
