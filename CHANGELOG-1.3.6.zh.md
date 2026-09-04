# CHANGELOG 1.3.6 — 自检修复:chip 写入自反馈死循环(blocker)+ 观察器治理 + 补偿孤儿清扫 + 泄漏与宽度缓存

日期:2026-09-04 · 范围:`lib/client.js` + `lib/index.js`(版本号)· 来源:独立代码审查(反方视角)逐条修复

## 背景

对 1.3.3–1.3.5 的吸顶折叠实现做了一轮独立审查,结论 FAIL(1 blocker + 3 should-fix + 多 nit)。
本轮逐项修复并真机复测。

## blocker:chip textContent 无条件写入 → 观察器自反馈死循环

`ensureStickyToggle` 每次都执行 `chip.textContent = …`;textContent setter 即使字符串相同也会
替换子文本节点,产生的 childList mutation 恰好被自己的 MutationObserver 捕获 → schedule →
rAF 重跑 → 再写入……自持帧频循环(持续 querySelectorAll + 强制布局 + DOM 写)。

修复:chip 上记 `data-label`,仅在与目标文案不同时才写入;首次创建时只写一次。
文案同时接入现有 i18n(`ZH` 分支:收起 ⌃/展开 ⌄ ↔ Collapse ⌃/Expand ⌄)。

## should-fix 修复

- **观察器治理**:`watchMainChat` 引入单例 `armed` 句柄,`arm()` 前先 `disarm()`(disconnect 两个
  observer、移除 scroll 监听、断开 ResizeObserver),HMR/重复 apply 不再累积多套监听;
  remount 分支现改为「`sc.isConnected === false` 或滚动器被替换 → 重置缓存并 disarm+re-arm」,
  且 `arm()` 对同一**仍在文档中**的滚动器幂等早退。
- **补偿孤儿清扫**:新增 `sweepStaleComp()`——React 在折叠保持期替换兄弟节点时,旧的
  `data-dsp-rest-comp` 标记(含 866px margin)会成为孤儿;每次 apply 前按行父容器清扫非当前
  兄弟的标记。补偿标记内现在保存宿主原有 inline margin-top(`empty` 表示原本没有),清理时
  **还原而非删除**,不破坏宿主样式。
- **泄漏**:remount 两处路径均重置 `stickyExpandedEl` 与 `naturalH`(改 `let`),滚动器离开文档后
  不再持有游离 DOM 子树与展开态引用。
- **宽度变化缓存过期**(与 1.2.0 dock 的唯一实质交叉):对滚动器挂 ResizeObserver,中央列宽度
  变化(dock/undock、拖 resizer、窗口缩放)即触发重测,补偿高度/钉住判定不再基于过期几何。

## nit 修复

- 删除死函数 `mainChatRows()`、死 CSS `.dsp-main-tail::after` 与非折叠规则上未消费的 `--dsp-pin-h`;
- chip 文案硬编码中文 → 走 i18n;
- `watchMainChat` 首次滚动器未挂载时,由「1s 后重试一次」改为 body 级观察器等它出现(懒加载场景不再静默失效);
- pick 循环不再 early-break,改为全量扫描取最后一个过线行(容忍瞬时 top 乱序)。

## 修不出来不是 bug 的:真机复测读数假象

复测期间一度出现"滚回底部后不再钉住"的读数,深挖后发现是**测试探针自己抓了 React 替换前的
旧滚动器节点**:第二次 `sc.scrollTop = …` 写在一个 `isConnected === false` 的死节点上,量出来的
当然全是假象(真实用户滚动永远作用于浏览器当前的滚动目标)。改用"每次操作前现查滚动器"后,
同场景钉住恢复且稳定。该探针假象也解释了为何审查只能静态怀疑、无法动态证实。

## 实测验证(真实页面 DOM 断言)

- 空闲 1.2s DOM 零 mutation(自反馈死循环已断;修复前每帧持续写入);
- 滚动到底:钉住 76px、pinTop 恒 84、补偿 866px、「展开 ⌄」;滚回顶部:完全展开、补偿清除;
  再回底部:重钉正常;
- 「展开 ⌄ ⇄ 收起 ⌃」往返正常(76px ⇄ 942px,补偿挂载/还原正确);
- 测试 28 项全过;`lib/`、`test/` 无任何残留死引用。

## 遗留(已接受,记录在案)

- remount 观察器仍常驻 body 监听(结构性成本,已过滤为轻查询;彻底根治需宿主提供生命周期事件);
- 折叠行的补偿值在宽度突变后由 ResizeObserver 触发的重测纠正,中间可能有一帧视觉过渡。
