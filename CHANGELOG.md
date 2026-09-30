# 更新日志

## v1.0.31（2026-10-01）

- **安装包瘦身**：包内更新日志只带最近 5 版（更早的更新记录仍在本插件仓库里）——由 SDK 自动施加，用户无需任何操作。

## v1.0.30（2026-09-30）

- **自有翻译归位（E6#161「谁的仓谁译文」）**：本仓 9 条可渲染文案的英文译名住进**本仓字典** `i18n/en.json`（新增 9 条） ＋ `contributes.i18n` 声明——不再依赖 `lang-defaults` 代管：文案在本仓声明、译名却在别的仓的字典里，本仓加一条声明那只仓无从跟上（跨仓追不上）。译名取值：池里现成的照抄（同键同值 ⇒ 按 E6#161「同值覆盖不出声」规则运行时零变化），池里没有的 5 条新写。
- **判据随 SDK 下发**：`@linkdesk/plugin-sdk` ^0.1.52 → **^0.1.61**——`npm run verify` 第 ⑧ 段「自有字典覆盖度」（manifest 渲染串缺口 🔴 / 源码 `t()` 缺口 ⚠️）由 `@linkdesk/plugin-sdk/own-dict-coverage` 判定（判据本体在 SDK，⛔ 不在本仓复制）。

## v1.0.29（2026-09-29）

- **右键菜单不再「同一项出现两次」**（05-插件更新 · 串口监视器候选补丁收口）——接收区右键的「复制 / 全选 / 清空」与快捷发送药丸右键的「编辑 / 删除」此前**各显示两份**。真因是同一批菜单项**注册了两遍**：一遍在 `plugin.json` 的 `contributes.menus`（声明式，带 `when` 门控），一遍在本仓 `src/index.tsx` 模块顶层的 `window.linkdesk.menu.registerItems`（带 `label`）。壳的判重键 = `command + pluginId + when`——声明式那份带 `when`、运行时那份的 `when` 是空，**判重键不同 ⇒ 两条都被当成不同菜单项留下**。**修法：删掉运行时那份，菜单只剩声明式一个源**。
- 运行时那份是 `E5.6#16.7k-fix` 留下的补丁——当年壳侧解析不到池侧命令的 `title`，只能手写 `label` 绕；**今天这条路已通**（加载器把 `contributes.commands` 连 `title` 注册进壳，菜单取不到显式 `label` 时按命令 `title` 显示）。现成反证：`togglePause` **只在声明式里有**，而它在右键菜单里一直只出现一次。
- **一处用户可见的文案变化**：接收区那一项从运行时那份手写的短文案「清空」变成命令声明里的标题「**清空接收区**」；其余五项文字不变。
- **分组随声明式那份**（原本两份的 `group` 还不一致，这次一并收敛）：接收区 = 「复制 / 全选」一组 ＋「清空接收区 / 切换接收暂停」一组；药丸 = 「回填到发送区 / 编辑」一组 ＋「删除」一组。
- 本仓 `AGENTS.md` 同步：删掉「`menus` 有一半在模块顶层注册、改菜单要两边都看」的旧说明，改成硬规矩——**右键菜单只有一个源（`contributes.menus`），⛔ 别再写运行时注册**。
- 无视觉变化（除上述菜单文案与分组）、零新命令、零新配置项、零新 IPC、**壳侧零改动**、`minAppVersion` 不动（仍 0.2.20）。
- 读数：`npm run test` 27 文件 / **326 例**全绿 · `npm run verify` 六段全绿（声明面 24 名归属零偏离 · 字典 132 key · 纯逻辑单元 16 个全有测试）。

## v1.0.28（2026-09-29）

- **命令面不再「猜靶子」也不再「认错人」**（M2 AI 友好化 · `AI#68`）——外部 AI 在 0.2.26 黑盒复测里撞到的两处都出在端口面：
  - **`openPort` 多会话下给 `portName` 必须点名 `sessionId`**：此前只给 `portName` 会改绑**当前活跃会话**的口，而活跃会话随用户切前台标签页变 ⇒ **同一条命令两种结果**（真机复现：用户为了配合调用切到 COM3 的标签页，于是同一个调用落到别的会话上）。这对无人值守的调用方不可推理，故**拒**：报错里一次给全「现有哪几条会话、各自绑谁、谁是活跃」并指向 `serial-monitor.listSessions`。⛔ 不猜、⛔ 不默认打活跃会话、⛔ 不静默新建。**不带 `portName` 的调用与单会话场景一概不受影响**（那时靶子就是「当前这条」，与手点侧栏「打开」同义）；已在开时也照旧回 `alreadyOpen`。回执另补 **`previousPortName`**（本次改绑前那个口，原本未绑为 `null`）——「这一笔动没动绑定」不用再从别处拼。
  - **`closePort` 回执里的 `sessionId` = 这个口的属主**：此前报的是「解析出来的那条会话」（缺省 = 活跃会话）——真机上关会话 48 的 COM3，回执却写 `sessionId: "…49"`，调用方拿回执复验「我关的是那条会话的口吗」会被误导。现在按口找属主（口开着却没有会话绑它 ⇒ 如实报 `null`）；**点名了非属主**就在回执里另带 `requestedSessionId`（「这个口属于谁」＋「你要的是谁」两条都给）。
- **命令面板标题改成与状态无关的动作名（消掉一个按构造会撒谎的读数）**：七条开关（六条会话态 ＋ `togglePause`）的标题此前按「现在开着没」在两条文案间翻——但**标题是「一个命令 id 一个槽」（壳侧全局共享），而状态是每条会话／每条标签页各自的**：多挂一个串口标签页就多一个写手，谁都可能把槽写成自己那条的状态（真机复现：活跃会话的开关明明是「开」，标题却读成「关闭…」）。现在七条一律固定动作名（「切换发送格式（文本 / HEX）」「切换消息回显」「切换行号显示」「切换系统消息独立显示」「切换自动重发」「切换自动清屏」「切换接收暂停」），视图侧那六处 `useEffect` 重注册**整块删除**——`useToggleCommands` 现在收不到任何状态参数（结构性保证：想按态写也没得写）。读状态只有两条正路：`serial-monitor.listSessions`，或开关回执里的 `value`（改后回读）。
- 声明面仍 24 条（无新增命令，只改 7 条标题文案与 2 条描述）＋ 字典同步：新增 7 个动作名词条、删掉 12 个已死的按态词条（「暂停接收」「继续接收」保留——工具栏按钮仍在用）。
- 无视觉变化、零新配置项、零新 IPC、壳侧零改动、`minAppVersion` 不动（仍 0.2.20）。
- 读数：`npm run test` 27 文件 / **326 例**全绿（`serialCommands.test.ts` 37 例，新增端口面 8 例：歧义拒＋负控「真没动」/点名通且活跃那条不动/单会话与不带 portName 照旧通/`alreadyOpen` 也带 `previousPortName`/回执认属主/点名非属主两条都报/属主查不到报 `null`/标题恒定；另新 `useToggleCommands.test.tsx` 4 例：标题恒为动作名 ＋ 三条回执路）；`npm run verify` 六段全绿（声明面 24 名归属零偏离 · 字典 132 key）。

## v1.0.27（2026-09-29）

- **会话能点名了**（M2 AI 友好化 · `AI#67`）：本插件是**多串口**的——同时开几条会话、每条一个口一套设置一个标签页。而此前命令面里「会话」只有一个隐含目标（活跃会话）：AI 名义上能改设置，实际未必改在它以为的那条上（外部 AI 在黑盒复测里正是撞到这里——它改了「会话2」，却发现动的是别的会话）。现在三件事：
  - **`serial-monitor.listSessions`**（新命令）：有**哪几条**会话、**谁是活跃**、每条的口与收发设置现况（`sessionId`/`name`/`portName`/`open`/`baudRate`/`sendMode`/`sendCoding`/`receiveCoding`/`showEcho`/`showLineNumbers`/`separateSystemLog`/`autoRepeat`/`autoClear`），外加两条视图态读数：`viewMounted`（该会话此刻有没有挂载标签页）与 `paused`（**没挂载时如实回 `null`**——「标签页没开」与「不是暂停态」是两件事，⛔ 不报 `false` 假装问过）。
  - **六条会话态开关收 `sessionId`**：`toggleSendMode` / `toggleEcho` / `toggleLineNumbers` / `toggleSystemLog` / `toggleAutoRepeat` / `toggleAutoClear` 都可点名要改哪一条；**缺省仍是活跃会话**（旧调用方一个字没改）。🔴 **点名了却找不到那条会话 ⇒ 如实拒**（`{ok:false,noop:true,reason:"bad-session"}` 并**列出现有哪几条**），⛔ 绝不静默回退到活跃会话——那会造出「账面无错、其实改了别的会话」，正是本版要消灭的形状。既有几条带目标的老命令（`openPort`/`closePort`/`closeSession`/`setSendCoding`/`quickSendDelete`）同笔诚实化：显式传了坏 id 就报出来，不再当成「没传」。
  - **开关回执带读数**：`{ok, sessionId, name, field, value, previous}`——`value` 是**改完从会话表读回来的**。此前回执什么都不回，门外只能从**命令面板标题**反推状态（标题是给人看的，会随状态变）——外部 AI 那条误判就是这么来的。七条开关的 handler 因此**从视图搬进插件级**（`services/serialCommands.ts`，常驻注册）：会话表是**模块级**单例、比标签页活得久，要改的那条会话可能**根本没开标签页**；视图现在只负责「按当前态换标题」。
- **`serial-monitor.listPorts`（新命令）——硬件面读数**：这台机器上**插着哪几个串口**（与界面「端口」下拉**同一条腿**，读数不可能与 UI 分叉），每条回 `{portName, description, open, sessionId}`——`open` 取插件自己的 per-port 权威态（与侧栏灯同一份），`sessionId` 是这个口**绑在哪条会话**上（一步接上会话寻址）。此前门外 AI 只有 `exec`，`serial.listPorts` 是门② 的 API、够不着 ⇒ 想指定口只能瞎猜。空读数如实回 `{ok:true,count:0,ports:[]}`（**不是报错**）；读口失败回 `{ok:false,noop:true,reason:"read-failed"}`——「问不出来」与「一个口都没有」处置相反，分得开。
- **声明面 19 → 24 条**：新增 2 条读命令（`when:"false"`，纯程序化、不进命令面板）＋ **补 3 条此前运行时注册却没声明的开关**（`toggleSystemLog`/`toggleAutoRepeat`/`toggleAutoClear`——声明面是壳侧唯一可发现性来源，缺了外部 AI 看不到）＋ 7 条开关补 `params`（`{ sessionId? }` 说明）。
- **回执房规**：新读命令与寻址命令的坏参**出在载荷里**（`{ok:false,noop:true,reason,error}`），⛔ 不抛异常——抛出去会经壳弹一张用户可见却无从下手的红条（与 21 章 `AI#62`/`AI#67` 判例一致）；老一批「人在菜单里点得到」的命令**保留抛异常**，两种形状并存是有意的。
- 无视觉变化、零新配置项、零新 IPC、壳侧零改动、`minAppVersion` 不动（仍 0.2.20）。
- 读数：`npm run test` 26 文件 / **314 例**全绿（`serialCommands.test.ts` 29 例——新增会话寻址 8 例：点名命中/缺省旧语义/坏 id 与「一条会话都没有」各如实拒/读回值/六条开关同形）· `npm run verify` 六段全绿（声明面 24 名归属零偏离 · 字典 137 key）。

## v1.0.26（2026-09-29）

- **AI 现在能把串口回声读回来了**（M2 AI 友好化 · `AI#64`）：新增两条**拉取式**读数命令——`serial-monitor.readSince`（入参 `since`/`limit`/`portName`，回 `{items, cursor, count, lost}`，每条 item 带 `seq`/`portName`/`text`/`hex`/`ts`）与 `serial-monitor.receiveStatus`（水位：`cursor`/`first`/`count`/`capacity` ＋ 每口 `{portName, count, open}`）。此前门③（CLI/MCP）的操作全是同步一问一答，AI 能开端口、能发指令，却**读不到设备回的什么**——调试闭环（发一条 → 读回声 → 据此算下一组参数 → 再发）断在最后一步。⛔ 不开流式订阅（不破「白名单 = 请求/响应」的形状）、⛔ 不走剪贴板、⛔ 不让 AI 自己开串口（COM 口仍由本软件独占持有）。
- **机制：接收面的第二个 sink**（新文件 `src/services/receiveLog.ts`）。原接收链是**视图作用域**的——`useSerialIpcEvents` 的订阅随视图挂载/卸载，数据落在 per-view `RingBuffer` 里且**被消费即清**（rAF 抽干后进 CM6）⇒ 没有串口标签页时，进来的数据**一个字节都不留**。新 sink ＝ **模块级**订阅 ＋ 一份**保留式**环形日志（容量 `RECEIVE_LOG_MAX` = 2000 条），由 `src/index.tsx` **入口顶层**订阅（与命令注册同处：AI 的第一腿 `openPort` 常常发生在没有任何串口标签页的时候）。两条链并存——壳的 `events.on` 是**每个订阅者一条独立 `ipcRenderer.on`**（`electron/ipc/event-system.ts`），模块级订阅不会抢走视图的事件（单测有共存钉子）。订阅**故意不随视图卸载退订**：它跟的是池页面（模块）寿命，不是视图寿命。
- **游标语义与诚实读数**：回执里的 `cursor` = 本次最后一条的 `seq`（无新数据 = 原样回你传的那个，便于原样续读）；`lost` = 因滚出缓冲而**读不到**的条数（大于 0 说明你落后了）——「答不上却看着像答了」在这条命令上被显式挡住。池页面重载后 `seq` 从 0 重来、而 AI 手里还攥着旧游标（会**静默饿死**）⇒ 显式负回执 `{ok:false, noop:true, reason:"cursor-ahead", cursor}` 把可用游标递回去。回执三态照壳的房规：**做成了** `{ok:true, …}` ／ **没有新数据** `{ok:true, noop:true, reason:"no-new-data"}` ／ **调用不成立** `{ok:false, noop:true, reason:"bad-since"|"bad-limit"|"bad-port"|"cursor-ahead"}`——参数错**照常 resolve**（抛出去会变成用户看得见、却无从下手的红条）。
- **`receiveStatus` 的口开态读主进程真源**：`window.linkdesk.serial.getStatus()` 返回数组时以它为准，仅在该 API 缺失时才退回插件本地的 `_openPorts`——本地那张表在池页面重载后会陈旧，据此判「口开着但设备没说话」会误判。AI 用它分辨「口没开」与「开了但没数据」，再决定拉不拉。
- **归一化：HEX 只有一份实现**——`toHexDisplay` 从 `useSerialIpcEvents.ts` 上移到 `src/utils/text.ts`（视图的 HEX 列与 AI 读到的 `item.hex` 共用同一个，防两处转义口径漂移）。
- **声明面 17 → 19 条**：两条新命令带完整 `description`（含三态回执与 `lost` 的说明）与 `params`；`when: "false"`——**纯程序化命令，不进命令面板**，与 `send` 同例（AI / CLI 执行不看 `when`）。
- **版本号**：`package.json` 1.0.21 → **1.0.26**（与 `plugin.json` 拉平——此前已漂移 4 个版本，AGENTS.md §6 要求两者同值，本版一并纠平）。
- 无视觉变化、零新配置项、零新 IPC、壳侧零改动；`@linkdesk/plugin-sdk` 仍 ^0.1.52（实测 `description` / `params` / `when:"false"` 已过 0.1.52 的 schema，无需为两行声明升 SDK）。
- 读数：`npm run test` 26 文件 / 304 例全绿（新 `receiveLog.test.ts` 23 例）；`npm run verify` 六段全绿（声明面 19 名归属零偏离、字典 135 key）。

## v1.0.25（2026-09-28）

- **补一批「只有鼠标路径」的动作：打开端口 / 关端口 / 关会话 / 改发送编码 / 快捷发送编辑删除**（M2 AI 友好化 · `AI#23`）。这五件事此前各自只有一个入口——打开端口是控制面板的按钮＋下拉、关会话是**悬停才出现**的那颗 ✕、快捷发送编辑/删除是药丸右键菜单、发送编码是侧栏下拉。命令面补齐后，AI 与外部调用方（`linkdeskctl exec` / MCP）也能做这些事。
- **声明面 12 → 17 条**：新增 `serial-monitor.openPort`（可指定 COM ＋ 波特率 ＋ 帧格式，即用户点名的「让 AI 选串口和波特率」）、`closePort`、`closeSession`、`setSendCoding`、`send`（此前只在运行时注册、清单里没有）五条；同时给**全部 17 条**补上 `description`（此前 12 条一条都没有）——命令说明随 `getCommands()` / `describe` 出契约，AI 靠它才知道这条命令干什么。`params` 声明补在需要实参的那几条上。
- 🔴 **命令本体走插件自己的写入咽喉，不绕过插件**：`openPortFromModule` / `closePortFromModule` / 会话写入咽喉（`getters.ts`）——与界面手点是**同一条链**，侧栏灯（`pluginState <port>:isOpen` ＋ contextKey `serial-monitor.sourceOpen`）、会话表、`serial.system` 消息三处一起动。⛔ 直调 `linkdesk.serial.openPort` 会「口开了、灯不亮、会话面板不知道」——那正是本版要防的新不一致。
- **归口**：新文件 `src/services/serialCommands.ts` 收「不需要视图在场」的插件级命令，由 `src/index.tsx` **入口顶层**注册（无视图时 AI 打进来，池的 on-command 激活 import 入口即命中）。⚠️ 视图卸载时的 `unregisterCommands` 是**粗粒度**的，会把入口顶层那批一并摘掉 ⇒ `useViewCommands` 的 cleanup 里**原样再调一次**同一份注册函数（幂等）——不补这一步，最后一个串口标签页关掉后这批命令会永久消失。
- **顺手归一化，不留第二份实现**：`openPort` / `refreshPorts` 的 React action 与会话的 create/remove 改为委托到同一处模块级咽喉；发送编码取值抽成 `SERIAL_CODINGS`（下拉与命令同一个值集，防「命令设得进、下拉选不出」）；`send` 补 `encoding` 实参（不传则用目标会话的发送编码），`portName` 缺省仍走原来的「缺省唯一口」语义——旧调用方一个字没改。
- **关会话的确认口径与手点一致**：`serial-monitor.confirmOnClose` 开着且未传 `confirm` 时先弹确认框；用户不点头 = 不做，且**如实回** `{closed:false, denied:true}`（不是「账面无错、实际没做」）。程序化调用方可传 `confirm:true` 跳过——否则无人应答的模态会把 AI 调用挂死。
- **回归钉子**（新文件 `src/__tests__/serialCommands.test.ts`，19 例）：① 三处一起动——命令开的口，灯 ＋ 会话表 ＋ `serial.system` 消息面逐条与手点一致，并断言**命令腿与手点腿的灯写序列逐字相同**（顺序敏感）；② **负控**——直调 `linkdesk.serial.openPort` 必须不绿（口开了但三处一处没动），这条防的就是「只断言口开了」的假绿。另覆盖：已开再开＝不动、无可用口如实报错、关会话的三步顺序、否认路径、编码白名单、`send` 的编码优先级、无视图删快捷发送、编辑快捷发送给可读报错（不是 null 解引用）。
- **依赖**：显式声明 `@linkdesk/contracts ^0.1.23`（原先靠 `@linkdesk/plugin-sdk` 传递拿到 0.1.13）——`meta.description` / `meta.params` 这两个字段的**类型面** 0.1.13 还没有，壳侧早就在用（`preload-pool/commands.ts`），不升级就是类型错、且旧类型会让人误以为这字段不存在。
- 无视觉变化。⚠️ 新增命令挂 `when: "activeEditor == 'serial-monitor'"` 只影响**命令面板显隐**；AI / CLI 执行不看 `when`（壳侧白名单只查命令 id 是否存在）。
- 读数：`npm run test` 25 文件 / 281 例全绿；`npm run verify` 六段全绿（声明面 17 名归属零偏离、字典 133 key）。

## v1.0.24（2026-09-27）

- **悬停提示收编（04「悬停提示系统」件 4）**：本仓 **18 处**小写标签上的原生 `title=` 全部换成壳的 `data-hint` 属性式提示（18 处说明类 ＋ 0 处揭示类另加 `data-hint-delay="0"`）；其中 **9 枚图标钮**（子代只有一枚 codicon 字形）同笔补 `aria-label`——它们原本唯一的名字来源就是那个 `title`，只换属性会让按钮变成「没名字的按钮」。
- **为什么换**：原生 tooltip 是 Chromium 的系统 UI，壳的 CSS 碰不到——不跟主题、不跟字号；`data-hint` 走壳自绘的提示条，并自动带出该命令的快捷键（与右键菜单同一份映射）。DOM 结构、类名、可见文字零变化。
- **`minAppVersion` 0.2.13 → 0.2.20**：提示条本体（`HintTipRenderer`）由壳提供，0.2.20 起才有——在旧壳上 `data-hint` 是惰性属性，那批按钮会**没有任何提示**（比原生 tooltip 更糟），故此版起要求应用 ≥0.2.20。
- **`@linkdesk/plugin-sdk` ^0.1.46 → ^0.1.49**：新腿 `check-native-title` 判红原生 `title=`（本仓现为 **0 处**）——本仓的 `ci-verify` 严格档自动吃这条腿。

## v1.0.23（2026-09-26）

- **修默认快捷发送发错字节**（E6#147 补测发现 · 用户拍板改法 a）：新会话默认那颗 `AT` 药丸，发出去的是**字面 `A T \ r \ n` 四个字符 ＋ 一个真 CRLF**——设备多半回 ERROR（它看到的不是 `AT` 命令行）。根因：`quickSends` 的值在发送链里是**正文**（`useSendData` 只对行尾 `ending` 做转义还原，正文原文照发），而 `DEFAULT_SESSION.quickSends` 存的却是**转义文本** `"AT\\r\\n"` ⇒ 值必须是正文，换行由 `handleQuickSend` / `sendInitOnOpen` 追加。
- **改法**：两处默认值统一为 `{ AT: "AT" }`——`useSerialSessions/types.ts` 的 `DEFAULT_SESSION`（原转义文本）与 `SerialMonitorView/settings.ts` 的无会话兜底（原真控制符 `"AT\r\n"`，它会与追加的 CRLF 叠成双换行）。两处此前**口径相反**，现在同值（`settings.ts` 那边加了一句「与 `DEFAULT_SESSION` 同值」注释）；口径规则也写进源码与测试注释：`lineEnding` 存转义文本、`quickSends` 存正文（不带换行），别「统一」成一种。
- **回归钉子两条**（`src/__tests__/useSendData.test.ts`）：默认值走完整发送管道 ⇒ 线上恰好 `AT\r\n`（值里自带换行或是转义文本都会红）＋ 无会话兜底与 `DEFAULT_SESSION` 深度同值（两处再分叉就红）。
- **影响面**：仅**新建**会话的默认 AT 药丸。**已存会话里的旧值不受影响**（值早落在会话记录里，仍按原文发）——要改就在那颗药丸的编辑框里改一次，值即换成正文。界面与接口零变化。
- `npm run test`（24 文件 / 262 例）与 `npm run verify` 五段全绿。

## v1.0.22（2026-09-20）

- **删四处死类名引用**（E6#136 普查裁决）：`serial-monitor-session-list-toolbar`／`serial-monitor-session-count`／`serial-monitor-session-list`／`serial-monitor-status-text` 在仓内 CSS 零定义、无消费（`SessionList.tsx` 的 F2 容器 `tabIndex`／`onKeyDown` 保留不动）——SDK 新腿（0.1.44 自有类名引用悬空判据）指出它们是死引用。删掉后渲染结果零变化。
- **SearchBar 两处 window keydown 补豁免理由注释**（E6#137 普查裁决）：Ctrl+F 全局打开与搜索开着时的 Esc/Enter 属「焦点在任何地方都要响应」的正当形态（搜索框未渲染或焦点可能已点走），判据本身无白名单——按腿的豁免出口加 disable 注释写明理由，行为零变化。



## v1.0.21（2026-09-19）

- **删 `.serial-monitor-sidebar` 规则本体＋收两条指向它的陈旧注释**（E6#113）：1.24（v1.0.17）已实证该类在实机 DOM 里不存在、并把 token 挪到三个真实根类之下，但规则本体留到今天；本轮删规则、退役 `SerialMonitorView.css` 的「别用它」警告、订正 `SerialMonitorSidebar.css` 头注的根类表述。删后仓内 src 零残留、`verify`／`test` 全绿。无功能变化。

## v1.0.20（2026-09-19）

- **声明最低壳版本 `minAppVersion: "0.2.13"`**（E6#128 · L9 收尾补正）：本仓自上一版起改由**壳池集中供给** `@linkdesk/ui`（构建时 external、运行时向壳要同一份实例）⇒ 需要 **≥ 0.2.13** 的壳（该版本起池里才有 `@linkdesk/ui` 这件货）。此前本清单**没写这个字段** ⇒ 市场与加载期都拦不住「新插件 × 旧壳」的组合（旧壳上插件视图打不开，壳被 ErrorBoundary 兜住、不崩）。本版**只加这一行清单字段 + 版本 PATCH**，源码与产物行为零变化。

## v1.0.19（2026-09-19）

- **换轨到「壳池集中供给」（E6#125 · L9 第 9.4 轮）**：`@linkdesk/ui` 不再编译进本插件 bundle——构建时 external，运行时由壳池供给同一份实例。源码 `import` 一行未改，只把依赖从 `^0.3.0` 换到重锚号 `^0.2.13`（`@linkdesk/ui` 自此与壳同号锁步）＋ `@linkdesk/plugin-sdk` `^0.1.19 → ^0.1.41`，重新构建发布。
- **读数（产物前后对照）**：包 **565,358 → 158,422 字节（−72.0%）**；根 bundle JS **978,655 → 435,217 字节**，CSS **→ 21,890 字节**。产物里组件实现痕迹（`data-overlay-wrapper` / `overlay-root` / `ldk-badge` / `ldk-button` / `ldk-form-row` / `ldk-toggle`）grep **零命中**；只剩 `from "@linkdesk/ui"` 裸 specifier 交给壳解析。
- **本仓 CSS 里对宿主类名的定位照旧生效**：`ControlPanel.css` 的 `.ldk-selectbox-trigger` / `.ldk-combobox*` 与 `className="ldk-input"` 一类写法没动——那些类名的**定义**现在由壳池全局供给，比过去「自带一份」更不容易漂。

## v1.0.18（2026-09-17）

- **上下文旗子带上归属**（E6#111n-3）：`sourceOpen` → `serial-monitor.sourceOpen`、`serialSessionFocus` → `serial-monitor.serialSessionFocus`。
  旗子是**运行时状态**（进内存 map，不落盘）⇒ **无迁移面**，老用户零影响
- **写点与读点同笔改**（关掉漏改那个静默失败模式）：
  - 写点 `src/services/SerialContext/store.ts:54`（`sourceOpen`）、`src/views/SessionListView.tsx:55,56`（`serialSessionFocus`）
  - 读点 `plugin.json:71,85,95` 的 `when: activeEditor == 'serial-monitor' && sourceOpen`
  🔴 旗子读取是「按名字碰」（拿名字当 map 键查）⇒ **漏一处不报错，只是门控静默失效**
- ⚠️ `serialSessionFocus` 经查**全仓无读点**（1.37 §14.2 已登记为死旗子）——按本轴禁区「只登记不删」**照旧改名**，去留另案
- 无功能变化——「暂停接收」菜单项的显隐条件与改前逐项一致

## v1.0.17（2026-09-16）

- **修 v1.0.16 的一处真缺陷：侧栏会话状态点的绿色丢了。** v1.0.16 把 `--serial-monitor-ok` 从 `:root` 挪到了三个「自有根类」之下，其中 **`.serial-monitor-sidebar` 是错的**——那个类名是当初 `sidebar.tsx` 还在时的容器类，**E36 拆分之后实机 DOM 里根本不存在**（侧栏视图由壳的 `.ldk-sidebar-section*` 包裹，插件侧只有 `.serial-monitor-session-*`）。⇒ 那条选择器是**空转**，侧栏里 `.serial-monitor-session-dot.on` 的 `background: var(--serial-monitor-ok)` 取不到值（自定义属性未定义 ⇒ `background` 变成初始值）——**那是肉眼可见的变化**，正是本轮要避免的东西。
- **改法**：选择器里的 `.serial-monitor-sidebar` 换成 **`.serial-monitor-session-item`**（侧栏会话行，状态点 `.serial-monitor-session-dot` 就在它里面）。三个选择器各自对应一个**实机存在**的消费子树：`.serial-monitor-view`（主视图，控制面板也在其下）／`.serial-monitor-session-item`（侧栏）／`.serial-monitor-serial-status-conn`（状态栏连接灯）。
- **实机复测（隔离 profile ＋ CDP）**：在真跑的池文档里 —— 侧栏子树内 `.serial-monitor-session-item` 上的 `--serial-monitor-ok` = `#22C55E`、其内 `.serial-monitor-session-dot` 同样 = `#22C55E`、状态栏连接灯消费出的 `color` = `rgb(34, 197, 94)`；**文档级 `--serial-monitor-ok` 为空**（不再有人写 `:root`）。
- **教训（写给下一位）**：「挂到自己的根类之下」这句话里，**「根类」必须是实机 DOM 里真有的类**——按 CSS 文件里的类名推断会踩空（这次就是）。查法：实机读该子树的 DOM class 链，别只看 `.css` 里定义了什么。
- 依赖与 v1.0.16 相同（随包 `@linkdesk/plugin-sdk` 0.1.26）；无功能变化。

## v1.0.16（2026-09-16）

- **连接状态的本地 token 改挂自有根类**（配合宿主的样式作用域纪律）：`--serial-monitor-ok` 原先在**三处** `:root` 里各定义一遍，现在**只在 `SerialMonitorView.css` 写一笔**，挂三个消费子树的根类之下——`.serial-monitor-view`（主视图）／`.serial-monitor-sidebar`（侧栏）／`.serial-monitor-serial-status-conn`（状态栏那颗连接灯的祖先）。**值不变（`#22C55E`）、消费点不变 ⇒ 零视觉变化**，改的只是**定义的位置**。
- **为什么要改**：`:root` 上的自定义属性**全文档可见**，而插件的样式表与宿主在**同一张表**里、后加载者赢 ⇒ 一条 `:root` 就能覆写宿主的契约名（宿主的颜色 / 圆角 / 层级大部分由样式表提供、不由程序写死）。宿主侧已把这条做成门禁（文档级作用域只有它自己的契约块能写），插件侧由 SDK 的 `check-css-namespace` 腿守着。
- **顺手清掉一处死代码**：`--serial-monitor-err` 全仓零消费方（定义之后从没被任何规则或 `style` 引用过）⇒ 随本次整块删除，不再定义。
- **订正两句陈旧的注释**：侧栏 CSS 头注里「`SidebarPool` 独立 WebContentsView、不共享主池定义」的理由**早已过期**（现在是最简 Pool、单 WCV，侧栏与主视图同文档）——那正是当初这处 `:root` 存在的原因，注释与定义一起清掉。
- **依赖**：随包 `@linkdesk/plugin-sdk` `0.1.25 → 0.1.26`（新版多一条 token 作用域判据；本仓已按它清零）。
- 无功能变化、无视觉变化。

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
