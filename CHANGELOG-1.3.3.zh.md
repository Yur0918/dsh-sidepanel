# CHANGELOG 1.3.3 — 修复:吸顶折叠在真实 DOM 里从未生效(slot 包裹层 `display:contents`)

日期:2026-09-03 · 范围:仅 `lib/client.js`(测量 + CSS)+ 测试 · 零内核改动,零依赖新增

## 问题

「定时任务」工作区的【每日定时播报 · DSH 插件市 会话里,942px 高的播报提示词钉住后
原样盖住整个视口:没有自动折叠、没有「展开/收起」角标、悬停也不出现「折叠 ⌃」。
排查确认:**1.3.0 的折叠功能在真实页面上从未生效过**,且对所有会话的所有长消息都失效,
与具体会话无关——该会话只是最长、最显眼。

## 根因(实测定位)

DSH 会话 UI(0.1.1-rc.2)渲染每条消息时,在 `.flowItem` 里先插一层插槽宿主:

```
div.flowItem
└─ div[data-slot="conversation.chat.node"]  ← style="display: contents"(无盒)
   └─ div.userRow(真实内容盒,长消息可达 900-2000px)
```

折叠逻辑三处都用 `item.firstElementChild` 当"内容元素"测高
(`stickyCollapseFor` 的 `pinnedHeight`、`applyFoldPass` 的 `tall` 判定、
`attachFoldBar` 的摘要文本),而 `firstElementChild` 是这个 `display:contents` 的壳:

- `scrollHeight === 0`、`getBoundingClientRect()` 为 0×0——**任何消息都测不出高度**;
- `stickyCollapseFor({pinnedHeight: 0})` 恒为 `none` → 钉住不折叠、无角标;
- `0 > 100` 恒假 → 永远不 foldable → 悬停「折叠 ⌃」从不出现;
- CSS 的 `> div:first-child` 也命中这层壳:`clip-path`/背景落在无盒元素上全部无效;
  `.dsp-folded > div:first-child{display:none}` 会被壳上的**内联** `display:contents`
  压掉(非 important 规则打不过内联样式)。

单元测试没拦住:`stickyCollapseFor`/`foldSummary` 是纯函数,输入是调用方给的
高度,DOM 测高这段不在覆盖范围内。吸顶 pin(1.2.0,只给 flowItem 加
`position:sticky`)不受影响,所以"钉住"看起来正常,折叠"静默失效"。

## 修复

- 新增 `pickBoxedChild(item, displayOf, isOurs)`:从 flowItem 向下穿过
  `display:contents` 的插槽壳(跳过自己 appended 的角标/折叠条),找到第一个
  **真实生成盒子**的元素;`displayOf`/`isOurs` 可注入,纯逻辑可单测。
- `boxedChildOf(item)`:live 封装,顺手给真实盒打上 `.dsp-pin-box` 类
  (幂等),CSS 从此不依赖"第一个子元素"这种结构假设。
- 三处测高/取文本全部改走 `boxedChildOf`。
- CSS:`> div:first-child` 全部改为后代选择器 ` .dsp-pin-box`(真实盒在插槽壳
  **内层**,子选择器打不中);折叠隐藏改为 `display:none!important`
  (必须压过壳的内联 `display:contents`)。

## 实测验证(127.0.0.1:3080,真实页面 DOM 断言)

【每日定时播报 · DSH 插件市 会话:

- 修复前:pinned 942px,`collapsed:0`、无角标、`foldable:0`、测高 0;
- 修复后:`collapsed:1`、角标「展开 ⌄」渲染(`display:flex`)、
  `clip-path:inset(0 0 calc(100% - 76px) round 10px)` 命中真实盒、
  不可见区 `pointer-events:none`、`foldable:1`;
- 「展开 ⌄ ⇄ 收起 ⌃」往返点击实测生效(展开态 `collapsed:0`、clip 移除);
- 回归:「渲染恢复测试」会话短消息(82px < 100px 阈值)照旧原样钉住,不折叠、无角标。

## 测试

29 项(新增 `pickBoxedChild` 穿透/跳过自身角标/空行兜底 5 组断言)。
