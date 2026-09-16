# 更新日志

## v1.0.15（2026-09-16）

- **适配宿主 E6#109l-b 的共享组件类名归一（`@linkdesk/ui` 0.3.0）**：共享组件余下的 52 个类名一律收进 `ldk-` 前缀——`colorpicker-*` / `ctx-*` / `form-row` / `inline-input*` / `number-input*` / `segmented-radio*` / `sidebar-section*` / `theme-picker*` / `theme-card` / `theme-preview` / `.tbadge` / `.tname` / `.pv-*`，外加关键帧 `selectbox-in → ldk-selectbox-in`。至此**宿主与共享组件自己定义的类名 100% 是 `ldk-` 开头**（258 ＋ 89 个独立定义，零例外），规则只剩一句、不再有任何登记表。
- **本仓源码零改动**：本仓自己的 CSS 与 TSX 对这批共享组件类名的引用逐条核过 = **0 处**（本仓用组件本身，没有用后代选择器去微调它们）。唯一的文字性残留是 `src/styles/SerialMonitorView-receive.css:166` 一句注释里提到的 `.ctx-overlay`——那是**早就不存在的旧名**，注释本身也是陈旧的，不影响任何行为（本次不改，避免混入非必要改动）。
- **依赖**：`@linkdesk/ui` `^0.2.0 → ^0.3.0`（**必须手动放宽区间**——0.x 的 caret 只在上界之内挑版本，`^0.2.0` 永远够不到 0.3.0）＋ 随包 `@linkdesk/plugin-sdk` `0.1.23 → 0.1.25`。
- **解包复核（真产物）**：解开本版的 `serial-monitor.linkdesk-plugin` ⇒ 本仓自己的 CSS/JS **旧名 0 命中**；随包 `@linkdesk/ui` 的 CSS 里新名有命中。
- `package.json` 的 `version` 顺带对齐到 `1.0.15`（此前停在 1.0.12、与 `plugin.json` 不同步）。
- 无功能变化、无视觉变化。

## v1.0.14（2026-09-16）

- **随包依赖对齐：`@linkdesk/ui` 由 `0.2.0` 升到 `0.2.1`。** 与 `settings` v1.0.13 同批——宿主 `.input → .ldk-input` 那次改名同时动了 `@linkdesk/ui` 这根轴，而本仓 lock 把 `0.2.0` 钉着（`npm install` 只要满足 `^0.2.0` 区间就不会动）⇒ 必须显式 `npm update @linkdesk/ui`。
- **本插件零可见变化，这一点是查过的、不是猜的**：解包 v1.0.13 与 v1.0.14 两份产物逐文件扫 `className` 字面量 ⇒ **裸 `input` 命中数两版都是 0**——本插件不消费 `@linkdesk/ui` 的 `NumberInput` / `FilePathInput`（那两个组件是唯一被改到渲染点的），所以「宿主改名」这件事对本插件**从来没有过功能影响**。两版差异只在**内嵌的 ui CSS/JS 那一层**：CSS 里裸 `.input` 选择器 3 → **0**、`.ldk-input` 0 → **3**（本插件渲染点没动，仍是 `ldk-input` 4 处 ＋ `ldk-setting-group` 4 处）。
- **那为什么还要发这一版**：让 18 只官方插件包里嵌的 `@linkdesk/ui` **停在同一版**（`0.2.1`）——否则下次谁再动共享组件，「这只包里的 dist 是哪一版」就得逐个解包才知道。本版付的是**一次版本号**，买的是**账目可读**。
- 复核判据（解包真产物）：两版裸 `input` 均零命中，本版 CSS `.ldk-input` 命中 3。
- 无功能变化、无视觉变化

## v1.0.13（2026-09-16）

- **适配宿主 v0.2.0 的类名改名**：宿主的输入框工具类 `.input` → **`.ldk-input`**，设置分组卡片 `.setting-group` → **`.ldk-setting-group`**（宿主把最后两个不带前缀的公共名一次收干净：**软件提供的样式名一律以 `ldk-` 开头**）。本插件 **8 处渲染点**同步改：快速发送栏 2 处、命令条过滤框 1 处、发送行为组的输入框 1 处，以及设置界面**四个分组 div** 上照旧渲染的宿主类名 4 处。
  - 那 4 处 `.setting-group` 是**借用宿主的类**（与 `className="input"` 同一性质）——v1.0.12 已把本插件自己挂在这个宿主类上的 `padding` 调优移进自有类 `serial-monitor-setting-group`，所以本次**只改宿主名、自有类一字未动**。
- **不改就是静默失配**——输入框丢掉宿主给的外观，四个设置分组丢掉卡片底色 / 圆角 / 内边距，都不报错。
- **同笔删掉一条死规则**：`src/styles/SerialMonitorSidebar.css` 的 `.serial-monitor-select-input` 自 v1.0.12 起**零渲染点**（18 仓 ＋ 池文档实机全扫无消费方）——该删除原本独立成一格（死规则一次裁决），本次按裁决**搭本插件发版的车**落地。
- **新增 `minAppVersion: "0.2.0"`**：旧壳用户得到「**需要应用版本 ≥0.2.0**」的明确提示（市场侧**拒装** ＋ 加载器侧拒载），而不是没样式的输入框。
- 无功能变化、无视觉变化

## v1.0.12（2026-09-15）

- **CSS 类名与关键帧全部带本插件前缀**（`serial-monitor-*`）：插件视图的那张样式表里同时装着宿主 CSS、共享组件 CSS 与**所有已加载插件**的 CSS，裸类名（`session-item` / `toolbar-btn` / `search-input` …）在这张表里是**全局标识符**——一方定义、他方渲染，两边样式落到同一个元素上，**不报错、只是长得不对**。本版把本仓 **63 个类名**与 **2 个关键帧**（`fadeIn` / `slideDown`）一律改成 `serial-monitor-` 前缀（只插入、不改词干），并同笔改了这两处关键帧的 `animation:` 引用
- **带走一起真实撞车**：`search-input` 此前与本插件的文件树各定义一份、规则体还不一样，级联合并后谁后加载谁赢一半——两边都加前缀后，这类撞车从构造上不再可能
- **两处刻意保留原名**（都是「别人的名字」，不是本插件自有元素的类名）：
  - `.cm-panels` 是 **CodeMirror 自己的类**（编辑器原生搜索面板，DOM 由 `@codemirror/view` 生成），本插件只对它做样式调优 ⇒ 规则改为 **scoped**（`.serial-monitor-cm-container .cm-panels`）：既不占全局名，面板样式也一字未变。（若照搬「加前缀」会把它改成一条**谁都不匹配的死规则**，搜索面板静默掉样式。）
  - `setting-group` 是**宿主** `src/index.css` 的全局工具类，本插件照旧渲染它（与 `className="input"` 同一性质的消费），另加自有类 `serial-monitor-setting-group` 承载原本挂在 `.setting-group` 上的那处 `padding` 调优
- 无功能变化、无视觉变化——24 个改动文件经机械证明逐字节等于改名前「只插入前缀」的字节

## v1.0.11（2026-09-15）

- **适配 `@linkdesk/ui` 0.2.0 的类名归一**：共享组件的裸类名（`badge` / `button` / `combobox` / `mdv` / `selectbox` / `sle` / `slider` / `toggle`）全部带上 `ldk-` 前缀——它们此前在「宿主 + 共享组件 + 所有已加载插件」同一张样式表里是**全局标识符**，通用英文词极易被插件自己的元素撞上。本插件对共享控件的四处 scoped 调优同步改名：`.control-bar .selectbox-trigger` / `.combobox` / `.combobox-field` / `.combobox-input` → 各自加 `ldk-` 前缀
- 这四行不改就是**静默失配**——命令条里下拉控件的背景、边框、圆角与字号那几条规则不再命中，控件会退回组件默认密度，没有报错
- `@linkdesk/ui` 升到 `^0.2.0`（`^0.1.4` → `^0.2.0`）。**必须手动放宽区间**：0.x 的 caret 只在上界之内挑版本，`^0.1.4` 永远够不到 0.2.0
- 无功能变化

## v1.0.10（2026-09-15）

- **分发件补上 MIT LICENSE**：`LICENSE` 早就在本仓里（E6#108g 那批加的），但**已发布的那版产物比它早** ⇒ 用户手上那份 zip 里一直没有版权声明。MIT 要求「副本里带声明」，而 zip 才是用户真正拿到的那份
- **不再夹带仓库面文件**：`@linkdesk/plugin-sdk` 升到 0.1.19（^0.1.14 → ^0.1.19）——旧 SDK 的打包通道会把 `marketplace.json` / `scripts/ci-verify.mjs` / `AGENTS.md` 这类**仓库面文件**一起装进 zip（那是给仓库看的，不是给用户看的），0.1.19 的排除表已覆盖
- 无功能变化——本版只为让「用户拿到的产物」与仓库对齐

## v1.0.9（2026-09-14）

- 源码迁入独立仓（E6#99，L7 第 7.2 轮）——从壳仓 `Encaron/linkdesk` 抽出本插件子树，历史全保（hash 变）
- 随包 `plugin.json` 显式声明 `pluginId`（E6#98g）：插件身份不再靠目录名兜底，独立仓构建出的包名与身份稳定
- `$schema` 改指本仓 `node_modules/@linkdesk/plugin-sdk`（脱离壳仓后原相对路径指到仓外，编辑器补全/校验会失效）


## v1.0.8（2026-09-11）

- 更新记录迁入包内的 `CHANGELOG.md`（E6#92 元数据归一）——此前写在 `plugin.json` 的 `changelog` 字段里，市场详情页读不到

## v1.0.7（2026-09-11）

- 内部整理（E6#87b 文件整理层）：1642 行主视图按 12 档拆为 24 件同名夹 + 591 行样式按分节拆三件 + 会话/设置/控制面板/上下文各归同名夹——功能与界面零变化

## v1.0.6（2026-09-10）

- README 展示区封面随包（E6#70a）：说明区静态图经 assetBase 解析 linkdesk:// 包内资产真加载

## v1.0.5（2026-09-09）

- 图标身份分工（E6#69 三图模型）：icon → resources/icon-bar.svg（Type-1 线稿剪影，仅图标栏用）；marketIcon → resources/icon.svg（Type-2 彩色身份图，市场列表/详情/标签栏同用）；整幅封面迁入 README 展示

## v1.0.4（2026-09-09）

- 小图标 icon.png → resources/icon.svg 彩 SVG 品牌块（E6#68b 现存非 SVG 清零）——图标栏/侧栏行显青绿数据帧色块，市场展示位仍用 cover.svg

## v1.0.3（2026-09-09）

- 声明 marketIcon=resources/cover.svg——市场详情展示位显「串口的窗」封面（E6#67 双图标样本：图标栏仍读 icon.png 小图标，市场读 marketIcon 展示图）

## v1.0.2（2026-09-08）

- 状态栏组件随包自声明——appearsIn.statusBar 改路径字符串（E6#62d）——SDK 编 statusBar.bundle.js 进 .linkdesk-plugin，池按 dist 消费，灯/口数不再编入壳池

## v1.0.1（2026-09-07）

- 状态栏组件存在性改声明式（appearsIn.statusBar）——打包版修复连接灯/口数实时渲染

## v1.0.0（2026-07-19）

- 初始发布
- 串口工具栏
- CM6 接收区 + Monaco 发送栏
- 侧栏设置（时间戳/编码/换行符）
