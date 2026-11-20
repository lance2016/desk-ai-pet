# 架构说明

## 设计原则

1. **宠物逻辑不依赖渲染库。** 只有 `PixiRenderer.ts` 引用 PixiJS。
2. **宠物逻辑不依赖桌面框架。** 只有 `platform/petWindow.ts` 引用 Tauri。
3. **动作是数据，不是代码。** 动作全部来自两份数据：标准动作目录 `standardActions.json` 和资源包的 `manifest.json`。
4. **同一时间只有一个主动作。** 所有播放请求都经过 `ActionController`。

## 目录

```
src/
├── types.ts                 公共类型：动作定义、属性、事件
├── core/
│   ├── EventBus.ts          带类型的事件总线
│   ├── PetState.ts          属性、活动状态、随时间衰减
│   └── PetRuntime.ts        把各模块组装起来，对外提供 requestAction
├── actions/
│   ├── standardActions.json 标准动作目录：每个角色都有的动作，怎么播、怎么画、没图时借谁的
│   ├── StandardActions.ts   把目录并进资源包清单：补默认设置，给没图的标准动作借图
│   ├── ActionRegistry.ts    动作的注册、查询、降级
│   └── ActionController.ts  播放、优先级、打断、冷却
├── behavior/
│   └── BehaviorEngine.ts    交互响应和自主行为
├── renderer/
│   ├── PetRenderer.ts       渲染接口
│   ├── PixiRenderer.ts      PixiJS 实现
│   └── motions.ts           程序化动效（呼吸、弹跳、摇晃等）；系统开了「减弱动态效果」时 `calmMotion` 去掉会移动整个宠物的几种
├── assets/
│   ├── Manifest.ts          manifest 的格式定义和校验
│   ├── AssetLoader.ts       读取资源包
│   └── PackCatalog.ts       内置角色和自建角色列表、默认角色、按 ID 加载角色包
├── storage/
│   └── PetStorage.ts        存档接口，当前用 localStorage
├── appearance/
│   └── looks.ts             每个动作实际显示谁的图：自己的、资源包的，还是借来的
├── agenda/
│   ├── changes.ts           两次读到的提醒相比，是新增了还是勾掉了（宠物据此做反应）
│   ├── AgendaStore.ts       提醒（每条都有时间）：校验、增删改、到点判断、本机存储与跨窗口同步、旧待办迁移
│   ├── Repeat.ts            重复提醒的规则：工作日、每天、每周几，算本轮和下一次
│   ├── Workdays.ts          中国法定工作日：打包的节假日数据、缺年份时下载补上
│   └── chatTools.ts         给模型的时间和动作、提醒清单和今天的记录、把一次 `add_reminder`、`save_note` 调用读成提醒或备忘
├── chat/
│   ├── ChatThreads.ts       聊天会话：按角色保存多段对话、标题、上限、旧记录迁移
│   ├── QuickChat.ts         快速聊天用哪段对话、要发的消息、气泡里的纯文本和停留时间
├── notes/
│   └── NoteStore.ts         备忘：校验、增删改、置顶、搜索、本机存储与跨窗口同步
├── facts/
│   └── FactStore.ts         记忆（关于用户的事）：校验、增删改、来源、本机存储与跨窗口同步、聊天里看到的样子
├── worklog/                 工作日志，见下文「工作日志」
│   ├── WorkLog.ts           事件种类、Zod 校验、本地日期
│   ├── listEvents.ts        写入前后的提醒、备忘相比，做了什么、改之前是什么
│   ├── recap.ts             某一天做了什么：抵消当天撤回的操作，加上折叠后的次数
│   └── store.ts             带日志的写入（`changeReminders`、`changeNotes`、`keepNote`）、按日期读、导入旧专注记录、折叠 30 天前的日子
├── greeting/
│   ├── GreetingSchedule.ts  早安晚安什么时候该说、今天说过没有
│   ├── GreetingContent.ts   问候里提到的事实、模板问候
│   └── Greeter.ts           定时检查、请模型写问候、失败时用模板
├── preferences/
│   ├── CharacterPreferences.ts 当前角色、按角色生成存储 key、旧数据迁移
│   ├── QuietPreferences.ts  勿扰、免打扰时段，判断现在是否该安静
│   ├── DisplayPreferences.ts 本机显示偏好与跨窗口同步
│   ├── DockPreferences.ts   Dock：内置按钮、角色按钮和动作合成一个有序列表，校验、迁移、同步
│   └── ActionTriggerStats.ts 按角色记录实际开始播放的次数
├── ai/                      AI 模块：窗口只用 index.ts 导出的 `ai`，见下文「AI 模块」
│   ├── index.ts             对外入口：Key、聊天、文本处理、问候、测试连接、提示词预览、请求记录
│   ├── provider.ts          供应商（目前只有 DeepSeek）、按 HTTP 状态给的报错
│   ├── prompt.ts            系统提示词分段、文本处理的提示词
│   ├── requests.ts          组装请求体：普通聊天、网页回合、文本处理、把工具结果交回模型的下一轮
│   ├── stream.ts            读 OpenAI 格式的流，把工具调用拼完整
│   ├── skill.ts             能力表的契约：`Skill`（一段提示词和它的工具）、`Tool`、`ToolOutcome`、`EffectLine`
│   ├── chatRun.ts           跑一次回复：读流、执行工具、需要时再请求一轮（最多 4 轮）、发事件给窗口
│   ├── completions.ts       不走流式的请求：问候、测试连接
│   ├── requestLog.ts        开发者模式的请求记录
│   └── deepseek/            DeepSeek 特有：正文里泄露的格式（leaks.ts）、读网页和联网搜索（web.ts）
├── skills/                  宠物在聊天里能做的事，每组一个文件，`index.ts` 的 `CHAT_SKILLS` 定顺序
│   ├── memory.ts            记提醒和备忘，按编号改、删、勾掉提醒（可撤销）
│   ├── lookup.ts            查看提醒、备忘和今天的记录，给条目编号
│   ├── remember.ts          记住、替换、忘掉关于用户的事（只能动聊天里记的，可撤销）
│   ├── petActions.ts        让宠物做动作（回复还没写完就开始）
│   └── refs.ts              编号（r1、n1）和条目 ID 的对应，只在一次回复内有效
├── platform/
│   ├── llm.ts               模型通道：Key、发请求、取消（原生端 `llm.rs`），请求记录（原生端 `request_log.rs`）
│   ├── petWindow.ts         原生窗口操作：移动、贴边、改大小、弹菜单、可点击区域
│   ├── holidays.ts          下载某一年的法定节假日数据（原生端 `holidays.rs`）
│   ├── mailCode.ts          邮箱设置的保存、移除，接收「查收验证码」的进展（原生端 `mail_code.rs`）
│   ├── updater.ts           检查、下载安装新版本（Tauri 更新插件）
│   └── hitMask.ts           把宠物轮廓和菜单区域合成一张可点击区域表
├── update/
│   ├── UpdateNotice.ts      宠物定时查新版本，同一个版本只提醒一次
│   ├── releaseNotes.json    每一版的新功能，应用和发布脚本共用
│   └── WhatsNew.ts          更新后说一句、弹一次「新功能」介绍
├── components/
│   ├── PetStage.tsx         舞台，负责把鼠标操作转成事件
│   ├── PetControls.tsx      宠物脚下的快捷按钮底栏和「互动」菜单
│   ├── QuickChat.tsx        快速聊天：宠物脚下的输入条、头顶的回复气泡和复制内容的卡片、发送逻辑
│   ├── ChatLauncher.tsx     宠物旁边的聊天按钮，复制后跳动提示
│   ├── ControlIcon.tsx      快捷按钮的内置图标
│   ├── ControlIconView.tsx  渲染内置、资源包或用户上传图标
│   ├── today/TodayPanel.tsx “提醒”小面板（独立窗口）
│   ├── notes/NotesPanel.tsx “备忘”小面板（独立窗口，沿用 TodayPanel.css 的变量和控件）
│   └── settings/
│       ├── SettingsPage.tsx 独立设置窗口页面
│       ├── QuietSettings.tsx 勿扰和免打扰时段
│       ├── ChatSettings.tsx 「聊天」页：快速聊天和聊天记录
│       ├── QuickChatSettings.tsx 快速聊天快捷键、聊天按钮的位置、复制后提示
│       ├── FactSettings.tsx 「记忆」页
│       ├── DiagnosticsSettings.tsx 「日志与诊断」页
│       ├── ChatRequestLog.tsx 「开发者」页的请求记录
│       ├── actions/         动作库：素材墙、动作编辑、图层、把上传的图画到舞台上
│       ├── UpdateRow.tsx    「关于」页的软件更新：检查、下载进度、重启
│       ├── WhatsNewSheet.tsx 「新功能」介绍弹层
│       ├── FeatureGuide.tsx 「功能一览」页，内容来自 src/guide/featureGuide.json
│       ├── FeatureTile.tsx  功能图标（系统色圆角方块），功能一览和新功能介绍共用
│       ├── sections.ts      设置窗口有哪些页、侧栏顺序和名字
│       ├── settingsSearch.ts 设置搜索的索引和排序
│       ├── SettingsSearchField.tsx 侧栏顶部的搜索框和结果列表
│       └── SettingsPage.css 设置页样式
└── App.tsx                  创建运行时，控制窗口大小和菜单显隐

src-tauri/src/
├── lib.rs                   托盘、右键菜单、应用菜单；平时隐藏 Dock 图标，设置窗口打开时显示
├── alert.rs                 不可撤销操作前的原生确认框（NSAlert）
├── llm.rs                   模型通道：本机加密的 Key、供应商地址白名单、curl、按行转发流、取消
├── database.rs              应用的 SQLite（rusqlite）：打开 `worklog.sqlite`、按版本顺序跑 `MIGRATIONS`
├── request_log.rs           请求记录：每次请求一行概要（耗时、token，不含内容，留 90 天），开发者模式另存完整内容（留 100 条）
├── floating_panel.rs        把窗口变成浮动面板，能盖在全屏应用上；快速聊天时拿键盘、还键盘（仅 macOS）
├── proxy.rs                 读系统代理，交给 curl
├── mail_code.rs             查收验证码：163 邮箱账号（钥匙串）、IMAP 只读登录、等邮件、复制到剪贴板
├── mail_extract.rs          从一封邮件里认出验证码（纯规则，不用 AI）
├── quick_chat.rs            快速聊天的全局快捷键，以及拿键盘、还键盘的命令
├── handover.rs              复制后通知宠物窗口（只看变更计数和类型），点聊天按钮时读一次 1 分钟内复制的文字
├── click_through.rs         鼠标穿透：按可点击区域表切换窗口是否接收鼠标
├── diagnostics.rs           日志文件（tauri-plugin-log）、panic 记录，设置页查看、清理、在访达中显示、导出诊断信息的命令
└── worklog.rs               工作日志：追加、按日期读、折叠、导出、整体替换，只开有类型的命令
public/pets/                 内置角色：six-six（小祭司，默认）、girl-default（小糕）
```

## 模块职责

| 模块 | 负责 | 不负责 |
|---|---|---|
| `PetState` | 四项属性、清醒/睡眠、最近互动时间、时间衰减 | 动画 |
| `ActionRegistry` | 记录有哪些动作；动作缺失时找替代 | 决定何时播放 |
| `ActionController` | 决定一个请求能否播放；动作结束后回到待机 | 决定想播什么；修改属性 |
| `BehaviorEngine` | 把交互事件和时间流逝转成动作请求，并修改属性 | 实际播放 |
| `PetRenderer` | 加载单图/多图图层、播放动画、命中检测 | 任何业务规则 |
| `EventBus` | 传递事件 | 任何业务规则 |
| `PetRuntime` | 创建并连接以上模块，管理它们的生命周期 | 业务规则 |

## 调用关系

```
 用户操作                     时间流逝
    │                            │
 PetStage / PetControls      PetRuntime（每秒一次）
    │ 发事件                      │ state.advance() + behavior.tick()
    ▼                            ▼
 EventBus ───────────────▶ BehaviorEngine ───▶ PetState（改属性）
                                 │
                                 │ request("happy")
                                 ▼
 外部模块 ─ requestAction ─▶ ActionController ◀── ActionRegistry（查询、降级）
                                 │
                                 │ playAction("happy")
                                 ▼
                            PetRenderer ──▶ 屏幕
```

要点：

- **React 组件只发事件，不直接播放动作。** 例如点击喂食按钮只是发出 `pet.fed`。
- **`BehaviorEngine` 只提出请求。** 请求被拒绝时不修改属性，所以连点喂食不会刷属性。
- **动作结束由 `ActionController` 计时。** 结束时发出 `pet.action.completed`，然后回到待机。
- **动作次数只统计实际开始的播放。** `PetRuntime` 监听 `pet.action.started` 写入角色专属本机数据；被拒绝的请求不会计数。
- **界面通过订阅 `PetState` 更新。** 用的是 React 自带的 `useSyncExternalStore`，没有引入状态管理库。

## 事件

| 事件 | 数据 | 谁发出 |
|---|---|---|
| `pet.clicked` | `{ region: "head" \| "body" }` | `PetStage` |
| `pet.petted` | 无，摸摸头：长按宠物 0.5 秒不动，或右键菜单「摸摸头」 | `PetStage`、`App`（菜单） |
| `pet.chat_requested` | 无，聊天按钮或全局快捷键打开快速聊天输入条；宠物先醒来、从边上出来 | `useQuickChat` |
| `pet.chat_phase` | `{ phase: "idle" \| "listening" \| "thinking" \| "talking" \| "failed" }`，对话进行到哪一步 | `useQuickChat`、`App`（转发聊天窗口的） |
| `pet.noted` | 无，新增了一条提醒或备忘 | `App`（比较存储变化） |
| `pet.item_done` | 无，勾掉了一条提醒 | `App`（比较存储变化） |
| `pet.mail_code` | `MailCodeUpdate`：`waiting`、`found`（带 `code`、`sender`、`copied`）、`unrecognized`、`timeout`、`cancelled`、`unset`、`failed`（带 `message`） | `App`（转发原生事件 `pet://mail-code`） |
| `pet.hovered` | 无，光标移到了宠物上 | `App` |
| `pet.user_active` | `{ at }`，用户最近一次碰键盘或鼠标的时间（任何应用里），每 10 秒读一次系统空闲时长 | `App` |
| `pet.drag_started` | 无 | `PetStage` |
| `pet.drag_ended` | `{ dockSide: "left" \| "right" \| null }`，松手时贴到的屏幕边缘 | `PetStage` |
| `pet.dock_changed` | `{ side: "left" \| "right" \| null }`，开始或结束贴边 | `BehaviorEngine` |
| `pet.fed` | 无 | `PetControls` |
| `pet.wooden_fish` | 无 | `PetControls` |
| `pet.sleep` | 无 | `PetControls` |
| `pet.wake_up` | 无 | `PetControls` |
| `pet.focus_toggled` | 无，开始一轮专注；专注中则在常驻气泡里问要不要停 | `PetControls`、`PetSpeech`（气泡按钮） |
| `pet.focus_badge_clicked` | 无，点了脚下的休息倒计时 | `PetSpeech` |
| `pet.action.started` | `{ actionId }` | `ActionController` |
| `pet.action.completed` | `{ actionId }` | `ActionController` |
| `pet.say` | `{ text }`，气泡里显示的一句话 | `PetRuntime.say()` |
| `pet.focus_completed` | 无，一轮专注正常结束（中途停止不算） | `BehaviorEngine` |
| `pet.greeting` | `{ text, offerMove? }`，宠物出来打招呼并说这句话；`offerMove` 时再问要不要把之前没做完的提醒挪到今天 | `PetRuntime.greet()` |
| `pet.alert` | `{ text \| null, heading?, more?, icon?, choices? }`，常驻气泡（提问、验证码、到点提醒、专注完成），`null` 表示收起；`heading` 是事项上方或按钮旁的小字（「到点啦」「别忘了」）；带 `choices` 时只有按钮能回答，每个按钮发一个指定事件，最后一个（非危险操作时）画成主按钮；`immediate` 表示这是点了按钮才问的（专注的停止、提前开始），立刻顶掉正在显示的临时气泡，不排在它后面 | `BehaviorEngine` |
| `pet.alert_dismissed` | 无，用户点掉了常驻气泡 | `PetSpeech` |
| `pet.reminders_done` | 无，提醒气泡上的「完成」：勾掉气泡里的提醒 | `PetSpeech`（气泡按钮） |
| `pet.reminders_snoozed` | 无，提醒气泡上的「10 分钟后」：过一会儿再提醒 | `PetSpeech`（气泡按钮） |
| `pet.leftovers_moved` | 无，早安后气泡上的「挪到今天」 | `PetSpeech`（气泡按钮） |
| `pet.badge` | `{ chips }`，角色脚下的一排状态小块（专注/休息倒计时带进度、提醒数、勿扰、等验证码）；专注阶段由界面收起状态行，空数组也表示隐藏 | `BehaviorEngine` |

动作统计监听 `pet.action.started`，以实际开始的 `actionId` 为键写入 `characterKey(packId, CHARACTER_DATA.actionTriggerStats)`。该键从本次更新开始为空，不迁移旧历史；动作库手动预览会计入，跨窗口存储变化会刷新动作库计数。请求被控制器拒绝时不会产生事件，也不会计数。

单击宠物：聊天按钮不显示时意思是“我要跟你说话”，`useQuickChat` 收到 `pet.clicked` 就打开输入条；显示按钮时只是碰碰它。两种情况 `BehaviorEngine` 都只负责叫醒和从边上出来，不播反应、不加属性。摸摸头不抢这个入口，改由 `pet.petted` 触发：`PetStage` 按下后计时 500 毫秒，期间没松手也没移动就发 `pet.petted`，之后松手不再算点击，移动仍然开始拖动。事件里仍带 `region`，但不再区分头部和身体。

## 动作调度规则

收到一个请求后，`ActionController` 按顺序判断：

1. **找到可播放的动作。** 动作存在就用它；素材缺失就沿 `fallback` 找；都没有就用 `idle`。
2. **已经在播同一个持续动作**（如待机时请求待机）：直接算成功，不重播。
3. **冷却中**：拒绝。
4. **能否打断当前动作**：当前动作必须允许被打断，并且新动作优先级不低于它。否则拒绝。
5. **播放。** 有时长的动作到时间后结束，回到待机。

`stop()` 无视优先级，直接回到待机。唤醒、松手、从边上出来时用它退出持续动作。

## 属性规则

属性范围 0～100，数值定义在 `PetState.ts` 和 `BehaviorEngine.ts` 顶部的常量里。

| 情况 | 饱食 | 精力 | 心情 | 亲密 |
|---|---|---|---|---|
| 清醒，每分钟 | −1/3 | −1/4 | −1/6 | 不变 |
| 睡眠，每分钟 | −1/6 | +2 | 不变 | 不变 |
| 喂食 | +25 | | +5 | +1 |
| 摸摸头（长按或菜单） | | | +3 | +2 |

- 属性每满一分钟结算一次，结算后存档。互动造成的变化立即存档。
- 应用关闭期间按"睡眠"结算，最多算 8 小时。
- 情绪（开心、平静、低落、困倦、饿了）由属性推算，不单独存储。

## 自主行为

`BehaviorEngine.tick()` 每秒被调用一次，只做几次比较：

- 清醒且正在待机时，每隔 6～14 秒从 `idle` 类动作里随机播放一个。
- 用户离开电脑 5 分钟就睡着，入睡前 20 秒打一个哈欠。「离开」看的是最近一次互动和最近一次碰键鼠（`pet.user_active`）里较晚的那个，所以用户在别的应用里干活时宠物一直醒着。拿不到键鼠活动时（浏览器里的 `pnpm dev`）只看互动。属性不影响入睡：界面上看不到属性，用户无从知道为什么它睡得早。
- 自己睡着的宠物，用户一回到电脑前（上报的时间晚于入睡时刻）就醒来，播 `wake_up`；被用户叫去睡觉的（`pet.sleep`）一直睡到用户点击或按唤醒。键鼠活动每 10 秒读一次，所以醒来最多晚 10 秒。
- 光标移到空闲的宠物上，它看一眼（30 秒内最多一次）。悬停本身不算互动，但移动鼠标算碰了电脑。

## 场景和姿势

各个入口只报告发生了什么，播什么由 `BehaviorEngine` 决定，动作名都来自标准动作目录（见 [ACTIONS.md](./ACTIONS.md)）。

**随对话保持的姿势。** `pet.chat_phase` 说明对话进行到哪一步：`thinking`（识别语音、等回复）摆 `think`；`listening`（输入条开着、打字、录音）和 `talking`（回复输出中）不摆姿势，只算「对话进行中」；`idle` 结束对话，`failed` 结束并播一次 `confused`。快速聊天直接在总线上发；聊天窗口是另一个窗口，用 `petWindow.reportChatPhase()` 发原生事件 `pet://chat-phase`，`App` 校验后转到总线上。

- 引擎同一时间只保持一个姿势（`heldPose`）：等回复的 `think` 排在专注的前面，回复开始出字就回到专注姿势。`settle()` 负责摆上和放下，事件到来、每秒 tick、任何动作播完时各调一次。
- 只有待机、空闲小动作和引擎自己摆的姿势会让位。一次性反应先播完，再回到姿势；`think` 这种有时长的姿势播完立刻重播，中间不闪回待机。
- 睡着或贴边时不摆姿势。`thinking` 和 `talking` 会叫醒宠物（消息已经发出去了），`listening` 不会。
- 每个阶段有保质期（`chatHoldMs`）：`listening` 8 秒，每次按键续上；另外两个 2 分钟。窗口中途消失时宠物不会一直等着。
- 对话进行中（`inConversation`）宠物不做小动作、不入睡、不回边上，不管这时有没有姿势。

**一次性反应。** `pet.noted` 播 `write`，`pet.item_done` 播 `happy`（10 秒内最多一次）。这两个事件由 `App` 比较提醒和备忘的存储变化得出，所以哪个窗口改的、是用户还是 AI 改的都算。宠物睡着或贴边时不为它们醒来或出来。提醒到点播 `remind`，问候播 `wave`，这两个会把宠物叫出来（`callOut`）。睡着时由它们直接把宠物叫醒，不先播 `wake_up`：`wake_up` 不可打断，会把它们挡掉。

## 舞台

宠物窗口比角色大，是一块透明舞台。角色区域四周的留白由 `STAGE_MARGIN`（`platform/stageGeometry.ts`）定义：两侧让聊天按钮和较宽的气泡放得下，头顶放气泡，脚下放快捷按钮底栏或快速聊天输入条（同一时间只有一个）。窗口大小等于角色区域（清单 `canvas` × `scale` × 用户尺寸）加上留白。

- 渲染画布只占角色区域（`.pet-frame`），点击检测和动作轮廓都相对于它计算；命中区域表按留白偏移后再放进整窗。
- 限制在屏幕内、判断贴边、贴边对齐都按角色区域计算，窗口的留白可以伸出屏幕。几何计算是 `stageGeometry.ts` 里的纯函数。
- 窗口伸出屏幕的宽度通过 `petWindow.offscreenInsets()` 读出，写进 `--visible-left`、`--visible-right`。气泡和底栏只在屏幕可见的范围内布局，宠物贴边时底栏和聊天按钮都收起。
- 探头时气泡及状态徽标靠近对应屏幕边缘，气泡尾巴指向角色；贴边状态变化时重新计算提醒气泡的可点击区域。
- 普通气泡只显示，不接收鼠标，不进入命中区域表。底栏（平时半透明也照样能点）和打开的「互动」菜单、聊天按钮、常驻气泡和状态行显示时加入命中区域表；状态行里每一块各管各的：休息倒计时发 `pet.focus_badge_clicked`，「提醒 N」打开提醒面板，「等验证码」调 `mail_code_cancel` 取消，「勿扰」只是标签。专注时状态行和快捷按钮隐藏，只有光环顶部的莲花按钮额外加入命中区域表。状态行在底栏上方，贴边时回到窗口底部。
- `SpeechQueue` 一次只显示一句，按字数决定停留时间（2.5～8 秒），最多排队 3 句，超出时丢掉最早排队的。

## 专注陪伴

`FocusTimer`（`behavior/FocusTimer.ts`）只管时间：关闭 → 专注 25 分钟 → 休息 5 分钟 → 关闭。时间由调用方传入，电脑睡眠后醒来也能按真实时间结算。`PetRuntime.focus` 对外提供快照和订阅；快捷按钮显示「专注 / 再来一轮」，专注期间收起，系统菜单仍可结束当前一轮。

宠物在专注时怎么表现，由 `BehaviorEngine` 决定：

- 开始时退出贴边姿势，请求 `focus` 动作。专注期间隐藏普通气泡、提醒气泡、快捷按钮、聊天入口和状态行；提醒状态仍保留，离开专注后恢复显示。精确倒计时显示在顶部莲花下方。
- 专注期间不播放随机小动作，也不会睡着。点击、喂食照常有反应，结束后回到 `focus` 姿势。
- 专注结束：播放 `happy`，被接受时心情 +5、亲密 +2，然后进入休息并改为显示休息倒计时。
- 休息结束：提醒可以再来一轮，徽标隐藏。
- 专注中重复收到 `pet.focus_toggled` 时会暂存是否停止的问题（`focusPrompt`），但专注界面不显示确认气泡；光环顶部的莲花按钮和系统菜单的停止项直接结束，不弹确认框。`focusPromptMs`（15 秒）没回答就按继续收起。休息中点倒计时问「继续休息 / 开始专注」。阶段一变（结束、停止、开始）问题就作废；按“休息”让宠物睡觉也会停止。
- 常驻气泡同时只显示一件事，顺序是：专注提问 → 验证码结果 → 挪到今天 → 到点提醒 → 专注完成。点掉最上面的，下一件才出来。
- 专注结束和休息结束都算一次互动，避免刚结束就因为“太久没互动”睡着。

专注中的画面装饰不归引擎管：`FocusAura`（`components/FocusAura.tsx`）直接订阅 `PetRuntime.focus`，在宠物身后画细进度环和脚下缓缓呼吸的水波。进度弧逐渐收短，端点随之移动。顶部莲花下方显示精确时间，悬停或聚焦莲花时显示「结束专注」，点击直接结束。专注期间收起快捷按钮、聊天入口、状态行和所有提示气泡；提醒与其他常驻提示仍由引擎保存，离开专注后恢复显示。按钮边界单独加入命中区域表，避开人物和光环。停止或自然结束后，光效淡出再恢复普通界面。拖动和贴边时光环不显示。休息阶段恢复常规按钮和休息倒计时徽标。

## 提醒和备忘

要记的东西只按有没有时间分：有时间的是提醒（`agenda/AgendaStore.ts`，界面上叫「提醒」，代码里沿用 agenda 和 today），没有时间的是备忘（`notes/NoteStore.ts`，代码里叫 notes）。这样 AI 不用猜“记一下”是哪种意思。

聊天里的工具调用由 `chat/toolEffects.ts` 的 `applyToolCalls` 落库，并把存下的提醒和备忘交回给聊天。聊天窗口在回复下面、快速聊天在回复气泡里显示“已设提醒：今天 15:00 · 开会”（`itemSummary()`）和「修改」，或“已存进备忘：…”和「查看」。修改调用 `petWindow.openToday(id)`，先发 `pet://today-item` 再显示面板，面板直接进入这一条的编辑状态。

提醒存在全局 key `ai-pet:agenda:v1`，不属于某个角色。每条都有 `remindAt`，还有 `doneAt` 和 `remindedAt`。聊天窗口和提醒面板都能写入：面板可以新增（`addAgendaItem`，开始输入时时间默认是今天下一个整点）、改文字和时间（`editAgendaItem`，时间变了就清掉 `remindedAt`，让新时间重新提醒）、勾选、删除和撤销删除（`restoreAgendaItem`）；宠物窗口读取并标记已提醒；三个窗口通过 `storage` 事件和 BroadcastChannel 同步。添加时清掉今天以前完成的提醒，最多保留 100 条；满了先挤掉已完成的，再挤掉已经提醒过、时间已过的一次性提醒，最后才轮到最早创建的，所以几个月前建的「每天吃药」不会被挤掉。已经提醒过、过期 3 天还没勾的一次性提醒（`archiveStale`）在添加时和面板打开时自动归入已完成。一次性提醒改到以后的时间会重新变成未完成。读取时逐条校验（`storage/listStorage.ts` 的 `readList`），坏的一条丢掉、其余保留；整份读不了时先把原文另存到 `ai-pet:agenda:v1:broken`。备忘同样处理。

**重复提醒。** 提醒可以带 `repeat`：`"workdays"`（中国法定工作日），或星期数字数组（0 是周日，七天都有就是每天）；一次性提醒是 `null`，旧数据读进来默认 `null`。重复提醒的 `remindAt` 是第一次提醒的时间，只用它的时分和起点，`addAgendaItem` 和 `editAgendaItem` 会把传入的时间换成“现在之后的第一次”（`firstOccurrence`）。改了规则或时分就从现在重新开始，清掉 `remindedAt`；只改文字不影响。

重复提醒不在存储里滚动时间，每次都现算（`Repeat.ts`）：

- 本轮（`occurrenceAt`）：时间已经到了的最近一次。今天的时间没到，本轮就还是上一次。第一次之前没有本轮。
- 到点：本轮没完成、`remindedAt` 早于本轮。应用关了几天也只补最近一次；错过的那次（比如落在勿扰里、电脑合盖）一直算到点，直到被点掉、勾掉，或下一次的时间到了。
- 勾选：重复提醒的 `doneAt` 存的是被勾掉的那一次（面板当时显示的时间），不是勾选的时刻。所以补勾昨晚错过的那次，不会连今天的一起勾掉。
- 完成（`isDone`）：面板上显示为已完成，指 `doneAt` 在今天或之后。第二天自动变回未完成；所以添加时清理旧的已完成提醒会跳过重复提醒。
- 面板显示的时间（`shownAt`）：到点还没处理的显示本轮，否则显示下一次；已经提前勾掉的那次跳过。列表按这个时间排序。

**法定工作日。** `Workdays.ts` 读 `chinese-days` 包的 `dist/chinese-days.json`（打包进应用）：`holidays` 里的日子放假，`workdays` 里的周末补班，其余按周一到周五。宠物窗口每小时调一次 `refreshHolidays`，每天最多真正检查一次：今年没有数据就下载今年，10 月起明年没有就下载明年。下载走原生命令 `fetch_holiday_year`（`holidays.rs`），先试 npmmirror，再试 jsDelivr；404 表示还没公布，第二天再试；网络失败下一小时再试。下载到的年份用 Zod 校验，存在全局 key `ai-pet:holidays:v1`，同一年整年替换打包的数据。没有数据的年份按周一到周五算，提醒面板和设置页会写出数据只到哪一年。

以前的版本允许没有时间的普通待办。`loadAgenda` 读到这种条目会略过；每个窗口启动时（`main.tsx`）把没做完的用 `timelessAgendaTexts` 取出存成备忘，再用 `dropTimelessAgenda` 从提醒里删掉，做完的直接丢弃。备忘遇到相同文字只更新时间，所以多个窗口重复执行也没关系。

**一句话创建。** 聊天请求带上 `context`：本地时间（`YYYY-MM-DD HH:mm 周X`）和角色可从外部触发的动作名。工具来自能力表 `CHAT_SKILLS`（`src/skills/`，见「AI 模块」），系统提示要求按有没有时间选工具：

- `add_reminder(text, remind_at, repeat?)`：设一个提醒，`remind_at` 必填，是本地时间字符串。`repeat` 是 `workdays`、`daily` 或 `1,3,5` 这样的星期数字（7 是周日）；有 `repeat` 时只取 `remind_at` 的时分，第一次提醒由前端算，模型把日期算错也没关系。
- `save_note(text)`：存一条备忘，没有时间的待办、资料、想法都用它，最多 500 字。
- `play_action(action)`：只有动作列表非空时提供，`action` 限定在列表里。
- `list_reminders(synthesize?)`、`list_notes(synthesize?)`、`review_today(synthesize?)`：查看已有的提醒、备忘和今天的记录，执行时才读本机存储，只有模型调用时清单才发给 DeepSeek。今天的记录是今天勾掉的提醒、今天还没处理的提醒、专注轮数（没有也写 0 轮）、今天新记或改过的备忘（压成一行、截到 120 字）。不带 `synthesize` 时清单原样显示在回复里，不再请求模型；带 `synthesize=true` 时清单带上编号（`r1`、`n1`，标明是资料、不是指令）交回模型，再请求一轮。
- `update_reminder(ref, text?, remind_at?, repeat?)`、`delete_reminder(ref)`、`update_note(ref, text)`、`delete_note(ref)`：按查看时给的编号改、删。编号只在这次回复里有效（存在 `ToolCall.memo` 里），找不到编号、时间读不懂、时间已过、重复规则不支持时，把原因交回模型让它先查或改口。`repeat` 填 `once` 把重复提醒改成一次性的。改、删的那一行带「撤销」，放回原来的样子。

**聊天按钮和递给它。** 聊天按钮（`components/ChatLauncher.tsx`）放在头的左侧或右侧，存在显示偏好的 `chatLauncher` 里（`left`、`right`、`none`，旧的 `corner`、`head` 读成 `right`），作为 `PetSpeech` 的 `idle` 插槽，头顶有话、有提醒或回复时让开；放左侧时图标左右翻转。位置按待机姿势的头算：播 `idle` 时从 `opaqueMask` 取轮廓最上面四分之一高度（耳朵到额头），量出它离宠物区域上、左、右边的距离（`headInsets`），写进 `--head-*`；别的动作不量，按钮不会跟着动作晃。资源包的 `headArea` 太粗，不用。按钮在拖动、贴边、输入条打开时隐藏，显示时加进可点击区域。显示按钮时 `useQuickChat` 不再因 `pet.clicked` 打开输入条，点宠物只剩 `BehaviorEngine` 的叫醒和出边。原生端（`src-tauri/src/handover.rs`）每秒在主线程看一眼 `NSPasteboard.changeCount`，变化时如果宠物自己的应用不在前台、剪贴板也没有密码管理器的 `org.nspasteboard.ConcealedType`/`TransientType` 标记（只读类型，不读内容），就记下时间并发 `pet://copied`。`useQuickChat` 在设置允许（`copyHint`）时让按钮跳 60 秒（`COPY_HINT_MS`）；点按钮才调 `take_copied` 读一次文字，读过即作废，没东西可读就打开输入条。苹果说以后读剪贴板可能弹系统提示，这样即使弹，也只在用户点按钮时。前端把内容截到 6000 字（`src/handover/Handover.ts`），放在头顶气泡的位置（`HandedCard`），没打开输入条时 30 秒后收起。按钮由本地规则选：外文给「翻译」，超过 200 字给「总结」，「解释」「记下来」一直有，「问它…」打开输入条。「记下来」直接 `keepNote`，不调模型。其余按钮和用户打字提问都走普通的快速聊天，消息是「用户的话 + 标好的资料块」（`handedMessage`），资料块不能自己提前结束；按钮的回合只提供 `petActionSkill`（`BUTTON_SKILLS`），内容里写什么都改不了数据，打字提问提供全部能力，靠资料标记和回归集里的用例防。

**今日回顾。** 右键菜单的「今日回顾」由原生端发 `pet://review` 给宠物窗口；`App` 在当前角色的聊天记录里新建一段对话，只放一句用户消息（`REVIEW_REQUEST`），再用 `petWindow.openChat(id, true)` 让聊天窗口接着回答，和快速聊天交接给聊天窗口走同一条路。模型按系统提示调用 `review_today` 拿到今天的记录。聊天记录读不出来时不新建，只打开聊天窗口，由它提示。

`chatRun.ts` 把流式返回的工具调用拼完整，每轮结束后按顺序执行，每做成或没做成一件就给窗口发一个 `effect` 事件（回复下面那一行）。`add_reminder` 的时间缺失、不存在，或一次性提醒早于现在一分钟以上的，改存成备忘（`readReminderCall`）；`repeat` 读不懂就当一次性提醒；动作经 `petWindow.requestChatAction` 交给宠物窗口，照常检查类别和调度规则。模型只调了工具、没有文字时，用各工具自己的确认语拼一句（如“好，15:00 提醒你：开会”“好，以后工作日 11:00 都提醒你：点外卖”“好，存进备忘了”）作为回复存进历史。

**备忘。** 备忘存在全局 key `ai-pet:notes:v1`，最多 200 条。保存和已有备忘完全相同的文字时，不新增，只把那条更新时间提前。满了会挤掉最久没改的未置顶备忘，面板底部提示「备忘满了，移除了最旧的一条」并可以撤销（撤销会拿掉刚加的那条）；快到上限时计数显示成「195/200」。列表先排置顶，再按 `updatedAt` 倒序；复制不改顺序，免得点了之后那一行从鼠标下跑走。聊天的 `save_note` 和聊天窗口的「存进备忘」都调用 `NoteStore.ts` 的 `saveNote`；「查看」调用 `petWindow.openNotes(id)`，先发 `pet://note` 让面板清掉搜索并高亮这一条，再显示面板。备忘面板和提醒面板一样，失焦就隐藏。

**到点提醒。** `BehaviorEngine.tick()` 每秒向 `ReminderSource` 要到点、且用户还没看过的事项：

- 手动勿扰开着时（`holdsReminders`）新到点的不弹出，只把数量放进徽标，例如“专注 12:00 · 提醒 1 · 勿扰”。免打扰时段不拦提醒：时间是用户自己定的。
- 否则叫醒宠物、从贴边处出来（记下原来贴的边）、请求 `happy`，并发 `pet.alert` 显示常驻气泡。同时到点的事项合成 `text`「A、B」，`heading` 是「到点啦」；其中有超过 10 分钟的，`heading` 改成「别忘了」；超过两件写「A、B 等 N 件」并带 `more`，点击时同时打开提醒面板。之后又到点的事项会并进同一个气泡。宠物窗口被隐藏时，`App` 收到 `pet.alert` 会调 `show_pet` 不抢焦点地显示它。
- 气泡点掉 1.5 秒后、问候说完 10 秒后，原来贴边的宠物回到探头状态；期间用户点它、拖它、按按钮都会取消。
- 常驻气泡不自动消失。`PetSpeech` 把提醒画成通知的样子（琥珀色铃铛方块、事项做标题、「完成」是主按钮），并通过 `alertRef` 交给 `App` 加进命中区域表，所以能点到。点名一两件事的气泡带两个按钮：「完成」发 `pet.reminders_done`，`BehaviorEngine` 通过 `ReminderSource.complete` 勾掉这些提醒（存储变化再回来变成 `pet.item_done`，宠物开心一下）；「10 分钟后」发 `pet.reminders_snoozed`，`snooze` 把 `remindedAt` 记成现在、`snoozedUntil` 记成 10 分钟后，宠物说一句「好，10 分钟后再叫你」。到时间 `dueReminders` 会再交出这一轮（`snoozedUntil` 晚于这一轮、已到、之后没再处理过），这时已经超过 10 分钟，气泡的小字变成「别忘了」。改时间会清掉 `snoozedUntil`。超过两件的气泡不带按钮，点一下发 `pet.alert_dismissed` 并打开提醒面板，这时才标记 `remindedAt`。没处理就退出的提醒，下次启动会再出现。
- 气泡里的事项在“提醒”里被勾掉或删除后，下一秒就从气泡里拿掉；全部拿掉时气泡收起。
- 普通的话照常短暂显示，期间暂时盖住常驻气泡，说完后常驻气泡回来。

## 早安和晚安

宠物窗口每 15 秒调用一次 `Greeter.check()`：

1. 安静时（勿扰或免打扰时段内）直接返回。
2. `greetingDue()` 判断该不该问候。早安有独立开关和时间，窗口从设定时间开始持续 4 个小时；若设定时间落在定时勿扰内，则从勿扰结束后开始。窗口内要检测到用户最近 60 秒有键盘或鼠标活动才问候，应用保持打开但无人使用时不会抢先问候。晚安窗口是定时勿扰开始前 30 分钟。“一天”按早安设定时间划分，所以跨午夜的晚安仍算前一天。
3. 该问候时，先在 `ai-pet:greetings:v1` 记下今天已问候，再去生成内容，避免请求慢或失败时问两次。
4. `collectFacts()` 从提醒和工作日志（最近 7 天加今天）里整理事实：未完成数、今天完成数、下一个提醒、今天最近一次提醒（即路线图里的 `latest_reminder`）、今天的专注轮数、上一个有记录的日子（`lastActiveDay`，昨天就叫「昨天」，否则写日期）完成了哪些提醒和专注了几轮，以及之前没做完的一次性提醒（`leftoverReminders`：今天以前、没勾、没过期作废）。早安提今天的事、上一天和没做完的，晚安提今天的完成情况。
5. `ai.greet`（`src/ai/completions.ts`）用非流式请求让 DeepSeek 按角色性格写一句不超过 40 字的问候。没有 Key、网络失败或回复为空时，用 `templateGreeting()`。
6. `PetRuntime.greet()` 和 `sayProactively()` 共用安静判断和 20 分钟间隔；通过后发 `pet.greeting`，`BehaviorEngine` 叫醒宠物、从贴边处出来、请求问候动作并说话。设置中的「立即验证」会请求一次问候内容，通过 `greetOnRequest()` 显示，不改每日问候记录；专注时会拒绝测试。到点提醒也用同一段逻辑叫宠物出来。
7. 早安时有没做完的提醒，`pet.greeting` 带 `offerMove`。`BehaviorEngine` 通过 `ReminderSource.leftovers` 再取一次，放进常驻气泡（`moveOffer`，小字「之前没做完」），按钮是「不用了」（`pet.alert_dismissed`）和「挪到今天」（`pet.leftovers_moved`）。挪的时候 `ReminderSource.moveToToday` 调 `moveToToday`：排到今天同一时刻，已经过了就排到半小时后，清掉 `remindedAt` 让它到点再叫。气泡里的提醒在别处勾掉或删掉，下一秒就拿掉。

## 日志和诊断

原生端用 `tauri-plugin-log`（`diagnostics.rs` 的 `log_plugin`，第一个注册）把日志写到 `~/Library/Logs/com.aipet.desktop/ai-pet.log`，每行 `[日期][时间][来源][级别] 内容`，本地时间；满 1 MB 轮转，连当前文件最多留 3 个。开发时同时打到终端。Rust 一律用 `log` 宏，不用 `eprintln!`；`log_panics` 让 panic 也进日志。

每个窗口启动时调 `forwardToLog`（`platform/diagnostics.ts`）：`console.warn`、`console.error`、没接住的错误和 Promise 拒绝都经 `diagnostics_log` 写进日志，带上窗口名。纯浏览器下不转发。

「设置 → 通用 → 关于 → 日志与诊断」（`DiagnosticsSettings`，单独一页，日志用整页滚动，工具栏停在标题下）：`diagnostics_read_logs` 读所有日志文件末尾共 256 KB，`diagnostics/logEntries.ts` 解析成条目（堆栈并入上一条，来源翻成「聊天」「原生 llm」这类名字），最新的在最上面，最多画 300 条，按级别筛、搜索、复制。「清理」清空当前文件、删掉轮转出来的旧文件（当前文件被日志插件开着，只能截断）。「导出诊断信息」把版本号、系统版本、架构和同样的 256 KB 日志存成文本文件，保存面板在 Rust 里弹。

## 工作日志

按天记用户做过的事，同时是审计记录：每条记下是谁做的、改和删之前是什么。不记聊天原文。存在应用数据目录的 `worklog.sqlite`（`database.rs` 打开，`rusqlite` 的 `bundled`），Rust 端 `worklog.rs` 读写，只开 `worklog_append`、`worklog_read`、`worklog_compact`、`worklog_add_counts`、`worklog_export`、`worklog_replace` 几个命令，网页不能执行 SQL。前端只经过 `platform/worklog.ts`，纯浏览器下不记、读到空。

- **表。** `events`：时间、本地日期（前端算好的 `YYYY-MM-DD`）、种类、来源（`user` 手动，包括面板、宠物气泡按钮和撤销；`chat` 是聊天里的工具）、一行文字（最多 500 字，够放下一整条备忘）、改之前的文字、关联的提醒或备忘 ID。提醒的文字带时间（「今天 15:00 · 开会」）；改动的 `before` 是改之前的样子，删除的文字就是删掉的内容。`day_counts`：某天某种事件的次数。
- **表结构版本。** `database.rs` 的 `MIGRATIONS` 按顺序列出迁移脚本（第 1 个建工作日志的表，第 2 个建请求记录的表），`PRAGMA user_version` 记跑到第几个，每个在自己的事务里跑。发出去的脚本不能改，只能往后加。
- **种类。** 提醒的新建、完成、取消完成、修改、删除，备忘的新建、修改、删除，专注完成和中途停止。读的一方跳过不认识的种类，以后可以加。
- **从哪来。** 在写入的地方记，这样才知道是谁做的。提醒和备忘的改动都经过 `changeReminders`、`changeNotes`、`keepNote`（`worklog/store.ts`），它们写入前后各读一次，`agendaEvents`、`noteEvents` 比较出做了什么，带上来源写进日志。调用方：提醒面板、备忘面板、聊天里「存为备忘」和宠物气泡按钮（`user`），聊天工具（`chat`），撤销（`user`）。不记标记已提醒、稍后提醒、过期作废（`isStale`）、满了被挤掉这些整理动作，这类写入可以直接用 `updateAgenda`。聊天工具的 `effect` 目前只有提醒和备忘，已经在写入处记了，不单独记。专注：宠物窗口订阅 `FocusTimer`，专注转休息记完成，专注转关闭记中途停止（包括电脑睡着打断），来源算 `user`。
- **读。** `dayRecap` 算一天：完成了又取消的不算，记了又删的备忘不算，再加上 `day_counts` 的次数。今日回顾（`review_today`）合并日志和当前清单（日志之前的、或日志漏掉的也在），早安读最近 7 天。
- **保留。** 宠物窗口启动时和之后每 6 小时调 `tidyWorkLog`：30 天前的事件折叠成 `day_counts` 再删掉。旧版的 `ai-pet:focus-log:v1`（每天几轮）第一次启动时导入 `day_counts`，导入成功才删 key。

## 懂分寸

`QuietPreferences` 是全局设置：勿扰开关和每天的免打扰时段（默认 23:00～08:00，可跨午夜）。`isQuietAt()` 判断某一时刻是否安静。

- 勿扰在右键菜单里是一个勾选项。原生端只负责显示勾选和发 `pet://dnd`，保存由宠物窗口完成；宠物窗口启动时调用 `set_pet_dnd` 把已保存的状态同步到菜单。设置页修改后同样调用它。
- 安静（勿扰或免打扰时段）影响宠物主动开口：`PetRuntime.sayProactively()` 和问候直接丢弃。到点提醒只看手动勿扰，见上节。用户点了才有的反应（点击、喂食、专注开始和停止）和番茄钟的结束提示不受影响。
- `sayProactively()` 还限制频率：两句主动的话至少间隔 20 分钟。提醒不走这个入口，不受频率限制。

## 拖动和贴边

拖动没有交给系统处理，而是由 `PetStage` 自己移动窗口。这样能准确知道什么时候松手。

1. 按下后移动超过 4 像素，`PetStage` 发出 `pet.drag_started`，之后每帧最多移动一次窗口，同一时间只有一次移动在进行。窗口位置 = 起拖时的窗口位置 + 原生光标移动的距离；光标从原生端读（`petWindow.getCursor()`），不用网页的 `screenX/Y`（跨上下摆放的屏幕时会跳）。
2. `BehaviorEngine` 请求 `drag` 动作。睡着的宠物被拎起来会醒。
3. 松手时 `PetStage` 检查角色是否碰到屏幕左右边缘，发出 `pet.drag_ended`。
4. 松手后立即恢复当前应保持的姿势（如专注或思考），不等下一次定时检查，避免短暂闪回待机动作。
5. 碰到边缘且角色有自己的 `peek` 图时，`BehaviorEngine` 播放 `peek` 并发出 `pet.dock_changed`。`peek` 不借图，没有这张图的角色不贴边。
6. `App` 收到后移动窗口，让角色贴齐屏幕边缘。`PetRuntime` 收到后在右边缘时让渲染器镜像。

另一种镜像来自动作自己：`randomFlip` 的动作（目前是 `look_around`）每次 `playAction` 时由渲染器随机决定朝向（随机数由构造参数注入）。最终是否翻转等于「贴右边」异或「这次随机翻转」，画面、`hitTest` 和 `opaqueMask` 都按这个结果算；翻转发生在动作开始时，`pet.action.started` 本来就会让 `App` 重发可点击区域表。用户在编辑页改的开关存进外观覆盖（`ActionAppearance.randomFlip`），没存过的旧记录沿用清单的值。

启动时恢复上次的贴边状态，要等 `App` 订阅了 `pet.dock_changed` 之后再发 `pet.drag_ended`。事件总线不重放：发早了，引擎和渲染器已经贴边，`App` 却不知道，快捷按钮会按没贴边来排，气泡也不靠边。

贴边期间宠物不会自己做小动作，也不会睡着。点击它或再次拖动就会出来。

## 浮在最上面和鼠标穿透

**浮在全屏应用上方。** macOS 只允许"不激活自身应用的面板"出现在别的应用的全屏空间里。`floating_panel.rs` 在窗口首次显示前把它转成这种面板，并设为可加入所有空间。副作用是点击宠物不会抢走当前应用的焦点。「提醒」「备忘」两个弹出层也转成这种面板（`apply_popover`），在当前空间打开、用 `take_keyboard` 拿键盘，不激活应用，所以在全屏应用里打开也不会被切出全屏；聊天和设置仍是普通窗口。设置打开时应用为 `Regular`；宠物右键菜单显示期间临时切回 `Accessory`，菜单关闭后恢复 `Regular`，以免菜单被当前全屏空间遮住。

**鼠标穿透。** 窗口是矩形，但只有画出来的部分应该挡鼠标：

1. `PixiRenderer.opaqueMask()` 按 4 像素的格子报告当前画面哪些格子不透明。
2. `hitMask.ts` 把它向外扩 2 格，再加上菜单的矩形，得到整窗的可点击区域表。
3. 动作切换、镜像、窗口大小或菜单显隐变化时，`App` 把这张表发给原生端。
4. `click_through.rs` 每 40 毫秒比较一次光标位置和这张表，切换窗口是否接收鼠标，并把"光标是否在宠物上"通知前端。
5. 前端据此显示或收起菜单。鼠标按键按下期间不切换，避免拖动中途丢失事件。

菜单的显隐不依赖网页自己的悬停事件，因为窗口不接收鼠标时网页收不到任何事件。

## 为 AI 预留的入口

外部模块通过这几个入口影响宠物，都不能修改属性：

- `requestAction(id)`：请求播放动作，规则见下。
- `say(text)`：在气泡里说一句话。
- `sayProactively(text)`：宠物主动说的话，安静时或距上一句不到 20 分钟时丢弃，返回是否显示。
- `greet(text)`：和 `sayProactively` 规则相同，但宠物会醒来、从贴边处出来再说。

`requestAction(id)` 的规则：

- 动作先经过 `ActionRegistry` 校验，不存在的动作降级为待机。
- 再交给 `ActionController`，受优先级和冷却约束。
- 这个入口不接触 `PetState`，所以改不了属性。
- `system` 类动作（`sleep`、`wake_up`、`peek`、`drag`）和宠物状态绑定，外部请求会被拒绝。

文字对话窗口通过平台封装调用原生 DeepSeek 请求；对话进行到哪一步用 `pet.chat_phase` 告诉宠物（见“场景和姿势”），不直接请求动作，也不修改宠物属性。模型通过 `play_action` 工具选的动作同样经过宠物窗口的检查和 `requestAction`。

### 文字对话与密钥

**就绪状态。** 聊天窗口打开和每次获得焦点时都查一遍 DeepSeek 和 MiMo 的 Key 是否已保存。DeepSeek 没 Key 时发送按钮禁用并显示设置入口；MiMo 没 Key 时麦克风点了直接打开语音设置。顶栏状态由 `chat/chatStatus.ts` 的 `chatStatus()` 算出：录音中、识别中、生成中优先，其次是检查中和未配置，再其次是上一次失败（网络错误、Key 无效、余额不足、请求太频繁、识别失败），都没有就是待命。下一次发送或录音时清掉失败状态。

**错误分类。** 原生端返回的是给人看的中文报错，`chat/serviceErrors.ts` 的 `classifyServiceError()` 按关键词把它们分成未配置、Key 无效、余额不足、请求太频繁、网络错误和其他，聊天窗口、快速聊天和语音识别共用。Key 问题给“去设置”，其余只说明原因。


聊天窗口为独立 Tauri 窗口，从快速聊天的输入条或回复气泡打开，定位在宠物旁边的屏幕范围内。聊天历史和对话偏好使用本机存储；服务商 Key 由 api_keys.rs 在应用数据目录 credentials-v1 内加密保存，前端不读取已保存的 Key。原生端限定 DeepSeek 与 MiMo 的 HTTPS 地址，将密钥和请求体通过标准输入传给系统 curl；请求体由 `src/ai/` 组装（见「AI 模块」）。从访达启动的应用没有代理环境变量，`proxy.rs` 每次请求时用 `scutil --proxy` 读系统设置里的 HTTPS 或 SOCKS 代理，交给 curl（环境变量里已有代理时不覆盖，不支持自动代理配置 PAC）。`llm.rs` 把 SSE 的每个 `data:` 行原样转给发起请求的窗口，由 `src/ai/` 解析；请求使用 ID 区分，停止、关闭窗口和主动退出时取消子进程。MiMo ASR 只接收 WAV/MP3 base64，识别文本回填输入框由用户确认后发送；MiMo TTS 的原生命令和 `pcmAudioPlayer.ts` 仍保留，但聊天窗口暂时不再朗读回复。录音仅驻留内存、限制两分钟且不写入聊天记录。语音偏好保存在本机。钥匙串与网络请求当前支持 macOS，麦克风权限说明写在应用 Info.plist。

### 快速聊天

聊天是所有功能的入口（建提醒、记事、让宠物做动作都靠一句话），所以要能随时开口。输入条和回复都在宠物窗口里，不另开窗口。

- **打开。** 全局快捷键（`tauri-plugin-global-shortcut`，在 Rust 端注册，前端不需要插件权限）按下时，`quick_chat.rs` 在宠物被隐藏时先显示它，再发 `pet://quick-chat` 给宠物窗口；聊天按钮发 `pet.chat_requested`，聊天按钮不显示时单击宠物发的 `pet.clicked` 也算。`useQuickChat` 收到就打开输入条。
- **键盘。** 宠物窗口是不激活应用的面板，`canBecomeKeyWindow` 返回 true，所以能接收键盘而不把用户正在用的应用切走（和 Spotlight 一样）。打开时调用 `take_pet_keyboard`，让面板成为 key window 并把焦点交给网页；Esc 或再按快捷键收起时调用 `release_pet_keyboard`，面板先移出再不抢焦点地放回，键盘回到原来的应用。点到别的应用时网页收到 `blur`，输入条直接收起。
- **快捷键。** 默认 `⇧⌘ Space`，设置页可以录制任意组合，存成 `Shift+Super+Space` 这样的写法，按键名直接用 `KeyboardEvent.code`。组合必须含 ⌃ 或 ⌘：macOS 15 起，只用 ⌥ 或 ⌥⇧ 的 `RegisterEventHotKey` 能注册成功，但系统不再转发按键。前端 `recordShortcut` 和原生 `parse_shortcut` 各查一遍。录制时先注销旧快捷键，否则同样的按键会被它截走。设置页改了直接注册；宠物窗口启动时按保存的值注册一次，失败（被别的应用占用）时让宠物说一句提示。注册在主线程完成，命令写成 `async`，避免主线程等自己。
- **对话。** 每次发送都从本机重新读聊天记录。输入条每次从收起变成打开，都开一段新对话；打开期间接着说的续在这一段（`sessionThread`，`pickQuickThread`）。输入条开着时再点宠物不算重新打开。先把用户这句存进去，回复完成后再存回复，第一轮回复后在本机整理标题。工具和聊天窗口共用能力表 `CHAT_SKILLS`。回复失败或被停止时，如果工具还没做过任何事，把这句从聊天记录里拿掉、放回输入框，重发时不会重复；做过事（比如宠物已经动了）就留着。
- **回复气泡。** 回复显示在 `PetSpeech` 的位置，有回复时普通气泡和提醒气泡让开。Markdown 转成一行纯文本，最多四行，被截断时底部写「点开看完整回复」。存下的提醒和备忘只显示一条（有没记上的优先），其余写「还有 N 条」；改、删的那一条按钮是「撤销」。输入条开着时一直显示；收起后按长度停留 6～20 秒。点击在聊天窗口打开这段对话（没有 Key 时打开设置）。输入条和回复气泡显示时都加进可点击区域表。
- **和聊天窗口同步。** 每个窗口同时只有一个请求（`chatRun.ts` 按窗口互斥），聊天窗口和宠物窗口可以各自在回复；同一个窗口再发会收到「上一条还在回复」，前端把这句放回输入框。`llm.rs` 把流只发给发起请求的窗口；关闭聊天窗口不取消回复，只停录音和识别；回复照常写进聊天记录，再打开就能看到。`chatRun.ts` 分别累积文字和工具参数，文字边到边显示，`play_action` 的 JSON 完整且 ID 在枚举内时立即执行（`Tool.early`）。一次回复最多做一个动作。宠物窗口把请求送入运行时，动作控制器返回调度结果，聊天用它提示失败，或在模型只发工具时用本地话术补一句。调度不等待动画结束。完整清单和基础日报在本机组织，只有模型要读结果时才再请求一轮。聊天窗口只在当前角色的聊天记录 key 变化时重新读取，内容没变不刷新；`petWindow.openChat(threadId)` 先发 `pet://chat-thread` 让它切到这段对话再显示。快速聊天回复到一半时点「在聊天窗口打开」，请求在原窗口继续，完成后由聊天记录同步到聊天窗口。两边同时在同一段对话里生成回复时，后完成的一方会覆盖前一方，这种情况很少，暂不处理。

## AI 模块

所有向模型发的请求都由 `src/ai/` 组织，窗口只用它导出的 `ai`。原生端的 `llm.rs` 是一条安全通道：

| 层 | 负责 | 不负责 |
|---|---|---|
| `src/ai/`（TS） | 提示词骨架、请求体、读流、跑工具循环、DeepSeek 的毛病、报错措辞、请求记录的内容 | Key、网络；具体有哪些工具 |
| `src/skills/`（TS） | 每组能力的提示词和工具：定义、执行、给用户看的那一行、撤销 | 怎么请求模型 |
| `platform/llm.ts` | 调原生命令、收 `pet://llm-stream` 事件 | 任何 AI 逻辑 |
| `llm.rs`（Rust） | 本机加密的 Key、供应商地址白名单（`PROVIDERS`）、请求体大小上限、curl、取消 | 拼提示词、解读回复 |
| `request_log.rs`（Rust） | 把前端写来的请求记录存进数据库、按上限删旧的 | 读请求内容 |

- **一次回复。** `ai.start` 组装请求体，`chatRun.ts` 调 `llm_stream`。`llm.rs` 把 SSE 的每个 `data:` 行作为 `data` 事件发给发起请求的窗口，结束时发 `end`（HTTP 状态、curl 是否正常退出、是否被取消）。`chatRun.ts` 读流后给窗口发事件：`delta`、`effect`（工具做了什么，带可选的撤销）、`web-progress`、`web-result`、`web-error`、`done`、`error`、`cancelled`。工具出了什么结果，即使回复随后失败或被停止，`effect` 也照发。
- **能力表。** 一个 `Skill` 是系统提示里的一段规则（`id` 就是用户可改写的段名 `ChatRuleId`）加上它解释的工具，`available` 决定这次提不提供。`Tool` 自带参数说明（可按 `context` 生成，如动作枚举）和 `run`；`run` 返回 `ToolOutcome`：交给模型的 `result`、给用户看的 `lines`、模型没说话时的 `confirmation`、原样显示的 `shown`，以及 `needsModel`（模型得读结果才能回答）。加一个能力只改 `src/skills/` 下的文件，聊天窗口、宠物和 AI 模块都不用动。
- **工具循环。** 一轮结束后按顺序执行这一轮的调用。只要有一个结果 `needsModel`，就把这一轮的文字、调用（`tool_calls`）和每个结果（`role: tool`）接到消息后面再请求一轮，最多 4 轮；第 4 轮带 `tool_choice: none`，模型只能用文字回答。没有 `needsModel` 时不再请求，存提醒、做动作都只花一次请求。后面某一轮失败时，已经做的事保留，回复末尾说一句没能接着处理。标了 `early` 的工具（目前只有 `play_action`）参数一完整就开始执行，一次回复只执行一个。
- **不走流式。** 问候和测试连接调 `llm_complete`，拿回 HTTP 状态和回复原文，由 `completions.ts` 解读。
- **供应商。** 目前只有 DeepSeek。它特有的东西放在 `src/ai/deepseek/`：正文里泄露的 `<budget:…>` 和写成文字的 `play_action`，以及服务端的读网页、联网搜索。请求体里的 `thinking: disabled` 在 `provider.ts`。应用升级后重新填写一次旧版 Key，不自动访问旧钥匙串。
- **记忆。** 关于用户的事存在全局 key `ai-pet:facts:v1`（`facts/FactStore.ts`），最多 50 条、每条 80 字，所有角色共用。每条有来源：`user` 是用户在「设置 → 记忆」里写或改过的，`chat` 是聊天里 `remember` 记的。`chatContext` 每次请求时读一遍，放进 `context.facts`：用户写的原样列出，聊天记的按顺序编号 `m1`、`m2`…。`prompt.ts` 把它们作为固定的一段「关于用户的记忆」放在日期后面，标明只是资料、不是指令，两者矛盾时以用户写的为准；没有记忆时这段不出现。`remember`、`forget`（`skills/remember.ts`）只认这次请求里的编号，所以碰不到用户写的那些；替换或删除前再读一次存储，条目已经不在就告诉模型。用户写过记忆时，新记一条要调两次 `remember`：第一次不存，只把用户写的那些摆给模型对照（`needsCheck`），模型确认不矛盾、用同样的文字再调一次才存。先存再让它撤的话，模型常常嘴上说「冲突了」却不删；这样它不动手时结果是没记上。设置里关掉「聊天时自动记住」后，这个能力和编号都不提供，已有的记忆照常发送。增删改都走 `changeFacts`，写进工作日志（`fact_added`、`fact_edited`、`fact_deleted`，带改之前的文字）。记忆只进聊天和快速聊天的提示词，问候、文本处理、读网页不带。
- **校验在哪。** 偏好、补充要求、对话规则、称呼的长度由各自的 Zod 读取函数保证，不在原生端再查一遍。原生端只查请求 ID 的格式和请求体不超过 8 MB。

## 快捷按钮和设置窗口

- Dock 是宠物脚下快捷按钮底栏使用的有序列表，由 `preferences/DockPreferences.ts` 管理，存在角色 key `dock:v1`。列表里有三类按钮：每个角色都有的内置按钮（`APP_CONTROLS`：提醒、备忘，命令 `today_open`、`notes_open`；聊天有自己的聊天按钮，旧配置里的「聊聊天」读取时丢掉），资源包 `manifest.json.controls` 定义的角色按钮，以及从动作库加入的动作。按钮可以改名、换图标、隐藏和排序；动作只能隐藏、排序和移除。
- 读取时按角色现有的按钮和动作过滤：清单里没有的按钮、不能手动播放的动作丢掉，新出现的按钮追加在末尾。还没有 `dock:v1` 时，从旧的 `control-preferences:v1` 和 `action-shortcuts:v1` 迁移一次；“恢复默认 Dock”三个 key 一起清掉。
- 改动即时保存，通过 `storage` 事件和 BroadcastChannel（`ai-pet:dock`）同步到宠物窗口；设置页的 Dock 页和动作库也互相同步。排序用指针事件实现，不用 HTML 拖放，避免被原生窗口的拖放处理截走。
- 图标既可选用内置 SVG，也可引用包内 PNG 或用户上传的 PNG/JPG/WebP。新增命令仍需在 `PetControl` schema 和组件的安全映射中显式注册。
- 动作主图仍按原有帧动画和 `motion` 预设运行；`layers` 可叠加独立透明图片或帧表，逐层指定位置、层级和局部动效。主图动效会同步带动全部图层。
- 快捷按钮排成宠物脚下的一条底栏，一直显示，平时半透明，鼠标在宠物上时完全显示（停留时间用「快捷按钮停留」）；拖动、贴边、输入条打开时收起。底栏最多 `BAR_SLOTS` 格（`barLayout`）：所有动作和放不下的按钮收进「互动」菜单，菜单有内容时占一格。图标统一用线条图标（`ControlIcon`），动作在菜单里显示自己的第一帧。
- 窗口置顶通过原生事件同步菜单、设置与本机偏好；按钮收起时间通过显示偏好同步。
- 右键菜单与托盘菜单共享原生菜单，其中“设置…”打开独立 Tauri 窗口。「动作」子菜单由 `PetControls` 用 `sync_dock_menu` 填入角色自己的快捷按钮（喂食、敲木鱼、睡觉、用户动作），点了发 `pet://dock-item`，和点快捷按钮走同一条路。设置窗口打开时应用为 `Regular`；右键菜单弹出期间临时切回 `Accessory`，收起后再恢复。
- 应用菜单（`build_app_menu`）只在设置窗口打开、应用切成 `Regular` 时显示，但 ⌘, ⌘N ⌘W ⌘Q 和编辑快捷键一直有效。「新聊天」只在聊天窗口是 key window 时可用，发 `pet://chat-new`。⌘Q 用和菜单「退出」相同的 id，退出前会取消进行中的请求。设置页通过 `platform/petWindow.ts` 调整窗口尺寸和置顶状态，不直接依赖 Tauri API。
- 设置窗口仿照 macOS 系统设置：侧栏按「角色与外观」「聊天与 AI」「陪伴与工具」「应用」分组（`NAV_GROUPS`），内容是分组列表。「角色」负责切换、创建和导入导出；「角色设定」是从角色页打开的子页，集中管理当前角色的名字、性格、回复长度、补充要求和聊天形象。动作库和快捷按钮均按当前角色保存，动作库可直接切换角色。
- 「AI 对话」只放所有角色共用的 DeepSeek 连接、模型、网页阅读和基础对话规则。规则预览显示当前角色组装出的实际请求，但可改写的基础规则仍全局共用；角色名、性格、回复长度和补充要求保存在角色设置中。用户称呼与记忆属于所有角色共用的用户资料，放在「记忆」页。
- 「通用」放启动、窗口、开发者模式和「关于」入口；「关于」和「日志与诊断」是逐层打开的子页（`SUB_PAGES`），侧栏保持选中「通用」，子页标题上方提供返回。快速聊天设置在「聊天」，MiMo API Key 和语音识别语言在「语音」，勿扰和提醒的工作日在「陪伴与勿扰」，划词翻译和查收验证码在「划词与邮箱」。开发者模式打开后侧栏最下面多一组「开发者」，其中「请求记录」查看最近请求。快捷按钮停留时间放在「快捷按钮」页，并注明所有角色共用。
- 页面不往末尾无限追加：会一直变多的内容（日志、请求记录、记忆）各占一页；固定说明默认只显示前几行（「什么时候会连网」）；配好以后的设置步骤收起（查收验证码、API Key）。颜色都是 `SettingsPage.css` 顶部的语义变量，深色模式只换变量。

## 角色

一个角色就是 `public/pets/` 下的一个资源包目录，`public/pets/index.json` 列出所有内置角色。清单的 `persona` 字段给出默认称呼、性格、音色和语气。

本机数据分三层：

| 层 | 内容 | 存储 key |
|---|---|---|
| 角色包（只读） | 形象、动作、快捷按钮默认值、`persona` | 资源包文件 |
| 按角色的用户数据 | 属性、聊天会话、对话设置（含改过的名字和性格）、语音设置、Dock、禁用的空闲动作、动作外观覆盖 | `ai-pet:character:<角色ID>:<名称>`；外观覆盖在 IndexedDB 中按角色 ID 区分 |
| 全局设置 | 当前角色、自建角色列表、尺寸、置顶、显示偏好、API Key | 原有全局 key（自建角色在 `ai-pet:custom-characters:v1`）与原生加密配置 |

- 当前角色存在 `ai-pet:active-character:v1`，通过 `storage` 事件和 BroadcastChannel 通知所有窗口。
- `main.tsx` 订阅当前角色。宠物窗口和聊天窗口以角色 ID 作为 React `key`，切换时整个重新挂载：旧的运行时销毁，进行中的聊天请求和录音被取消。设置页不重新挂载，只重新加载角色包，并以角色 ID 作为 `key` 重建 AI、语音和动作库子页面。
- 每个窗口启动时调用 `migrateLegacyCharacterData()`，把引入角色之前的全局 key 一次性移到 `girl-default` 名下；新 key 已有数据时不覆盖。
- 角色包的清单 `id` 必须和目录名一致，`loadCharacterPack()` 会检查。宠物窗口也通过它加载角色，再把加载好的包交给 `PetRuntime.create({ pack })`。
- 自建角色的 ID 以 `custom-` 开头，只存名字、性格和借用的内置角色 `base`。`loadCharacterPack()` 加载 `base` 的资源包，换上自己的 `id` 和 `persona`，所以按角色 ID 存的数据（包括 IndexedDB 里的动作外观）天然和原角色分开。删除时调用 `clearCharacterData()` 清掉该角色所有 `characterKey` 数据，并逐个重置动作外观。
- 自建角色换了自己的待机图之后，只有用户上传过的图才算它的：没上传的动作借它自己的图（`looks.ts` 的 `planLooks`），不再显示 `base` 的形象。`PetRuntime` 启动时和每次换图后都重新算一遍每个动作显示谁的图（`showLooks`），出借的动作换了图，借它的动作跟着换。
- 显示的名字统一用 `characterName()`：用户在「角色」页改过就用改过的，否则用 `persona.name`。聊天窗口监听 `storage` 事件，设置页改名后立即更新。
- 聊天记录按段保存在 `chat-threads:v1`，最近的一段在最前，每段最多保存和显示 200 条（`CHAT_LIMITS.messages`），发给模型的只有最近 30 条（`CHAT_LIMITS.context`，`contextMessages()`）；每个角色最多 20 段。旧版的单份 `chat-history:v1` 第一次读取时转成一段对话后删除。
- 模型是全局设置 `ai-pet:chat-model:v1`（`src/preferences/ChatModel.ts`），默认 `deepseek-flash`。`requestPreferences()` 把它带进聊天和问候请求，`ai.test` 单独传 `model`；收到 400、404、422 时报「模型名不可用」，设置页据此拒绝换成写错的自定义模型。
- 标题先用用户的第一句话。全局开关 `ai-pet:chat-auto-titles:v1` 打开时（默认打开），`recordThread()` 在保存第一轮回复时用 `cleanTitle()` 在本机整理开场白。用户已改过的标题继续保留。
- 聊天窗口的头像和小人按角色存在 `chat-appearance:v1`：每个位置是一个动作 ID 或一张上传图片（`data:` URL），可以带一个取景 `crop`；小人还可以是 `hidden`。`pictureFor()` 把它变成图片地址和取景。上传图保存的是缩到 512 像素以内的原图（不透明的存 JPEG，带透明的存 PNG），不是裁好的结果，所以可以反复调整。
- 取景（`src/appearance/pictureCrop.ts`）记录画面中心点在图上的位置 `x`、`y`、取景框占图片宽度的比例 `zoom`，以及图片高宽比 `ratio`。`cropStyle()` 把它换算成 `<img>` 的 `width`、`left`、`top` 百分比；头像框是 1:1 的圆，小人框是 `FRAME_ASPECT.peek`（78:64）。裁剪弹窗 `PictureCropper` 和显示端用同一套换算，所见即所得。没有取景时沿用旧的默认取景：动作图头像裁到头部，小人露出顶部，上传图整张显示。动作已不存在时退回 `idle`，并丢掉原来的取景。
- 聊天窗口通过 `petWindow.setTitle()` 把标题栏改成“和<角色名>聊天”，需要 `core:window:allow-set-title` 权限。
- 你的称呼存在全局 `ai-pet:user-profile:v1`（`UserProfile.ts`），所有角色共用。`requestPreferences()` 把它作为 `userName` 和角色的对话设置一起交给 `ai.start` 与 `ai.greet`，在系统提示词里加一句“称呼用户为「…」”。长度上限 20。
- 首次引导：`ai-pet:onboarded:v1` 不存在时，宠物窗口启动后查 `ai.keyStatus()`。已有 Key 就直接记为完成（老用户不打扰），没有就调用 `open_settings`；设置页同样检查，然后显示 `WelcomeGuide`。完成或跳过都写入标记。
- `open_settings` 显示并聚焦设置窗口；带 `section` 时先向设置窗口发 `pet://settings-section`，设置页切到对应分区。浏览器模式下改为打开 `?window=settings&section=…`。
- 回复的 Markdown 由 `src/chat/markdown.ts` 解析成数据（段落、标题、列表、代码块，以及粗体、斜体、行内代码和链接），`ChatMarkdown` 只生成 React 元素，不使用 `innerHTML`。未闭合的标记和代码块按原样显示，流式输出时不会闪烁。
- 完整聊天的「自动阅读网页链接」是默认开启的全局设置（`ai-pet:read-links:v1`）。开启时，用户发送 HTTP(S) 地址触发读取，点输入框上的模式按钮可切回普通聊天。使用 Flash 非思考模式，只挂 DeepSeek 服务端的 `deepseek_read_url`（`src/ai/deepseek/web.ts`）；追问复用该网页对话，不挂工具。网页内容和网页回合不会进入可执行本机工具的普通聊天。服务端事件变成 `web-progress` 和 `web-result`，聊天中的链接和来源用按钮交给系统浏览器。最后的 `server_tool_calls` 按原样保存在对应回复中，供追问还原上下文；整个角色的网页快照有大小预算，超出时保留文字和来源，优先保留近期快照。首次读取没有成功页面或收到 `content_filter` 时丢弃已流出的文字。
- 完整聊天的「联网」仅用于本次发送，使用 Flash 非思考模式和 DeepSeek 服务端的 `deepseek_web_search`，复用网页进度与来源事件。单图输入支持选择、粘贴和向输入框拖放（聊天窗口关闭原生文件拖放拦截），先用画布缩小到最长边 1800 像素，发送时以内联 `image_url` 加当前问题交给 Flash。图片字节只在当前窗口暂存，不写入聊天记录或开发者请求日志。两个入口只发送当前问题所需的数据，不提供本机工具，不把这些回合转入可执行工具的普通对话。
- 对话设置和语音设置在用户没改过时使用 `persona` 的值。系统提示词在 `src/ai/prompt.ts` 拼接，性格长度上限 1000 字（`PERSONA_LIMITS`）。

## 换平台时要改什么

| 目标 | 需要重写 | 可以复用 |
|---|---|---|
| Windows | 基本不用改，验证透明窗口即可 | 全部 |
| iOS / Android | `platform/`、`src-tauri`、界面布局 | `core`、`actions`、`behavior`、`renderer`、`assets`、`storage` |
| 换渲染库 | 新写一个 `PetRenderer` 实现 | 其余全部 |
| 换存储方式 | 新写一个 `PetStorage` 实现 | 其余全部 |

## 测试

`core`、`actions`、`behavior`、`assets`、`storage` 和 `motions.ts` 有单元测试，用假的渲染器和假时钟，不需要浏览器。渲染、窗口和界面靠实际运行验证。

## 动作库与用户偏好

动作库从资源包读取动作、可选的显示名称和描述；新增动作无需修改设置页。标准动作按目录里的 `scene` 分组，说明文字是触发时机；自建角色还没画完时按 `tier` 分组成待画清单。普通且有结束时间的动作可保存为快捷入口，设置窗口通过平台层向宠物窗口发送请求；宠物窗口检查动作存在、类别和休息状态，再经 `PetRuntime.requestAction()` 调度。睡眠、拖拽、贴边等系统动作只展示触发方式。空闲动作的禁用列表保存在本机，`BehaviorEngine` 选取空闲动作时读取过滤；原有动作及素材不被修改。拖动结束及缩放后限制窗口水平位置在当前屏幕内，避免快捷按钮被屏幕边缘裁掉。

### 动作外观覆盖

`appearance/AppearanceStore.ts` 使用 IndexedDB 按资源包 ID 与动作 ID 保存经 Zod 校验的外观覆盖，保存完成才通知主窗口；设置窗口等待主窗口加载结果。上传的图片先在摆位框（`PictureCropper`）里摆到舞台上：舞台就是清单的 `canvas`，底边是地面。摆位计算在 `appearance/stagePlacement.ts`，画图在 `components/settings/actions/placePicture.ts`：每帧按同一个摆位画到舞台上，保存舞台上有画面的那一块（向下到地面，左右按中线对称，`align: left` 从左边算），多帧拼成横向 PNG。渲染器按原像素贴底画帧，所以保存后位置和大小与摆位框一致。按提示词画的正方形图，默认缩放让「站直 760 像素」等于待机图的可见高度；其他图默认按原动作图的尺寸放进去。帧图可重新排序和删除，不再缩放。外观覆盖可包含独立图层及其位置、缩放、层级、动效和主图可见帧范围；旧数据未包含图层字段时保留资源包默认图层。`PetRuntime` 启动时恢复覆盖，更新交由渲染器原子切换；加载失败保留默认资源。切换外观后重算鼠标命中区域。动作调度、优先级和属性规则仍来自资源包及行为引擎。

用户自己做的动作（`actions/UserActions.ts`）只保存名称和时长，存在角色 key `user-actions:v1`；图片就是同一个 ID 的外观覆盖。`withUserActions` 把它们追加到清单后面，条目的 `file` 借用待机图，类别为 `custom`，优先级 20。宠物窗口通过 `PetRuntime.create({ userActions })` 拿到它们；设置页新建、修改或删除后照常发外观变更通知，`refreshAppearance` 先重读列表，用 `PetRenderer.addAnimation`/`removeAnimation` 和 `ActionRegistry.register`/`unregister` 增删，再发出 `pet.actions.changed`，Dock 随之刷新。ID 形如 `my-xxxx`，含连字符，所以 `chatContext` 不会把它们交给 AI。

## 开机启动与备份

`src-tauri/src/system.rs` 用 ServiceManagement 的 `SMAppService.mainAppService` 把 app 注册为登录项，状态有 `on`、`off`、`approval`（在系统设置里被关掉）三种；`preferences/LaunchAtLogin.ts` 让安装版第一次运行时打开一次，开发构建跳过。备份由 `storage/Backup.ts` 生成：所有 `ai-pet:` 开头的 localStorage 值、IndexedDB 里的外观覆盖，以及第 2 版起的工作日志（`workLog`，全部事件和次数），Zod 校验后才恢复。第 1 版备份没有工作日志，恢复后日志为空。恢复先导出现有日志、整体替换日志（一个事务），再替换 localStorage（失败则写回原值），再在一个 IndexedDB 事务里替换外观；后两步失败则把 localStorage 和日志都写回。最后由原生端 `restart_app` 重启，让所有窗口重新读取。保存文件用 `tauri-plugin-dialog` 的原生保存面板，只从 Rust 调用，前端没有对应权限。

## 设置搜索和功能一览

- **功能一览。** `src/guide/featureGuide.json` 按组列出用户能用的功能：图标、颜色、标题、一句说明、怎么用（`how`，每条一个标签，含 ⌘⌃⌥⇧ 的显示成键帽）、对应的设置页（`section`）。`FeatureGuide.tsx` 只负责显示，加功能不用改代码。测试检查图标、颜色、页面都存在，标题不重复。
- **搜索的范围。** 侧栏顶部的搜索框（`SettingsSearchField.tsx`）搜三样东西：各页本身（`NAV_GROUPS`、子页 `SUB_PAGES`，以及开发者模式开启时的 `DEVELOPER_GROUP`）、设置项（`SETTINGS_INDEX`，每条是页面上显示的标题加别的说法）、功能一览的每条功能（说明和用法也算关键词）。排序：标题完全一样、标题开头、标题包含、只有关键词命中；同一档里标题短的在前。
- **跳过去。** 选中结果后切到那一页，在页面里找文字等于标题的 `strong`、`h2`、`h3`，滚到中间并加 `is-search-hit` 闪一下。页面的部分内容是异步加载的，所以每 100 毫秒找一次，最多找 1.5 秒。动作编辑有没保存的改动时不跳。
- **索引不会过期。** 测试读设置组件的源码：索引里的标题必须在源码里出现；源码里写死的行标题和分组标题（`<strong>`、`<h2>`、`<h3>`）必须在索引或 `SEARCH_SKIPPED` 里。新加一行设置忘了登记，测试会失败。

## 应用内更新

用 Tauri 更新插件（`tauri-plugin-updater`，前端权限 `updater:default`）。应用读 `tauri.conf.json` 里 `plugins.updater.endpoints` 指向的 `latest.json`（公开仓库 `desk-ai-pet` 最新 Release 里的文件，仓库必须保持公开），版本号更高时下载 `.app.tar.gz`，用 `pubkey` 校验签名后替换 `/Applications` 里的 app，再由 `restart_app` 重启。插件自带读系统代理（`system-proxy` 特性），不经过 `proxy.rs`。

- 宠物窗口：`update/UpdateNotice.ts` 在启动一分钟后和之后每 24 小时查一次，发现新版本走 `sayProactively()` 说一句，说出去才把版本号记进 `ai-pet:update-announced:v1`，所以同一版本只提醒一次，被勿扰挡住的下次再说。开发模式不查。
- 设置窗口：「通用 → 关于」页的 `UpdateRow` 负责手动检查、显示更新说明和下载进度、重启。
- 新功能介绍：每一版的内容写在 `update/releaseNotes.json`（按版本号，`features` 每条有图标、颜色、标题、说明，`more` 一句写小改动），测试要求当前 `package.json` 版本必须有一条。`update/WhatsNew.ts` 记两个 key：`ai-pet:whats-new-seen:v1`（关掉介绍时记下版本）和 `ai-pet:whats-new-announced:v1`（宠物说过「我更新到…了」）。宠物启动时，第一次运行的新用户两个都直接记上，不弹也不说；老用户没看过这一版就走 `sayProactively()` 说一句。设置窗口打开时没看过就弹 `WhatsNewSheet`（首次引导优先，引导结束也算看过），「通用 → 关于」页可以再打开。
- 发布：`scripts/release.sh` 从 `releaseNotes.json` 生成更新说明，Release 页面放完整列表，`latest.json` 只放标题连成的一行。只在发布模式下打开 `createUpdaterArtifacts` 并读私钥（`~/.tauri/ai-pet-updater.key`），本机安装（`--local`）不需要私钥。`latest.json` 由脚本生成，平台名按本机架构（目前只有 `darwin-aarch64`）。
# 主动陪伴

`Companion` 定期通过 `platform/system.ts` 读取 macOS 的系统空闲秒数，在本机判断深夜持续使用、连续使用与离开后返回。采样中断时不推断使用时长。场景通过 `PetRuntime.greet()` 共用主动说话间隔和问候动作；仅深夜关心允许用户选择绕过定时勿扰，手动勿扰始终生效。专注期间暂停场景触发，专注动作和完成提示由 `BehaviorEngine` 管理。

AI 对话补充要求按角色保存在 `ChatInstructions`，由聊天请求附带；问候不使用。聊天预览 `ai.preview` 直接调用与聊天请求共用的提示词和工具组装函数，不读取聊天记录、不调用网络。

当前时间、UTC 偏移、时区和未来日期由本地时钟动态提供。系统提示词由 `chatSections`（`src/ai/prompt.ts`）按段组装：`persona`、`date`、`memory`、`lookup`、`actions`（有可选动作时）、`instructions`（填了补充要求时），非空段用换行连起来。`memory`、`lookup`、`actions` 三段可被用户改写：`ChatRules`（`ai-pet:chat-rules:v1`，所有角色共用）随 `requestPreferences` 以 `rules` 发出，缺省用默认写法，空字符串表示去掉这一段。预览返回每段的 `text` 和 `default`，设置页据此显示「已修改」和「恢复默认」。

**请求记录分两层**，都由 `src/ai/requestLog.ts` 写、`request_log.rs` 存进数据库，都不进备份：

- **概要，每次请求都记。** 聊天每一轮、网页、文字处理、问候、测试连接，各记一行：开始时间、种类、窗口、模型、成功与否、HTTP 状态、总耗时、首字耗时（发出请求到第一个字或第一个工具调用）、输入和输出 token、缓存命中的 token。不含任何内容。留 90 天，以后用来显示用量（产品化 D）。流式请求带 `stream_options.include_usage`，DeepSeek 在 `[DONE]` 前的最后一块（`choices` 为空）给出整次用量，`parseStreamData` 读进 `usage`；非流式请求从回复的 `usage` 读。
- **完整内容，开发者模式才记。** 开发者模式（`ai-pet:developer-mode:v1`）打开时，`requestPreferences` 带 `record: true`，把这次回复的每个请求体（首个请求和可能的只读归纳请求，图片换成占位）、模型原样返回的文字、工具调用，以及同样的耗时和用量写进 `request_entries`（`llm_log_put`），留最近 100 条，重启后还在；设置页通过 `ai.requestLog`、`ai.clearRequestLog` 读取和清空，每一轮显示用时、首字和 token。

动作图层的上飘淡出按主图指定的显示帧范围计算进度，预览与渲染器共用动效采样。文字图层先生成透明 PNG，再按普通图层保存。

## 划词翻译

翻译快捷键与快速聊天分别注册，修改任意一个不会注销另一个。用户触发快捷键时，原生层通过 macOS 辅助功能接口读取当前选区，未授权、无选区或应用不支持时回退到手动输入；不模拟复制。翻译窗口使用独立的 DeepSeek 请求，只发送原文和翻译指令，不附带角色性格、聊天记录或工具。请求复用聊天流事件和取消机制，不保存翻译内容。

划词浮钮默认关闭，仅在用户启用且已授权辅助功能时检测鼠标拖选和双击，并尝试读取选区；文本只在内存里短暂保留，点击浮钮才发送。原生非激活面板提供翻译、解释、总结、润色四个就地按钮和详情入口；结果流式显示在选区附近，结果卡片顶部可以换一种处理，同一段文字重新请求（先取消正在进行的那次）。四种处理共用 `ai.translate`，任务是 `zh`、`en`、`explain`、`summarize`、`polish`（`TextTask`），提示词在 `textTaskPrompt`（`src/ai/prompt.ts`），都声明原文只是资料。详情窗口只做翻译，接收原文和已完成的译文。两个入口使用已捕获的选区，避免焦点变化后读取到其他内容；停用、失去权限、点击外部和浮钮超时都会清理。

## 查收验证码

入口是右键菜单和托盘共用的「查收验证码」。等邮件的循环在原生层（`mail_code.rs`）：菜单点一下开始，再点一下（这时叫「停止等验证码」）取消；宠物脚下的「等验证码」小块通过 `mail_code_cancel` 命令也能取消。开始时立即发 `waiting`，之后用一次 IMAP 登录撑完整个等待，每 2 秒重新 `EXAMINE INBOX` 看一次，最多 2 分钟。频繁重新登录可能触发 163 的风控，所以不这样做。

- **只读。** 用 `EXAMINE` 打开收件箱，正文用 `BODY.PEEK[]` 取，邮件不会被标成已读。
- **163 要先报名字。** 登录后必须先发 IMAP `ID` 命令（RFC 2971），否则打开收件箱时返回 `Unsafe Login`。curl 每次只能发一条 IMAP 命令，插不进 `ID`，所以这里用 `imap` crate 自己建连接，也因此不走系统代理（`proxy.rs` 只管 curl）。
- **挑哪一封。** 只看收件箱最新 10 封里 10 分钟内收到、不到 512 KB 的邮件，用一条 `UID FETCH` 一起下载，再从新到旧解析。同一次等待里每封只下载一次；已经给过用户的邮件（`delivered`，只在内存里）不再给，所以「重新发送」后再查收会等新的那封。
- **认码。** `mail_extract.rs` 先看标题、再看正文（HTML 由 `mail-parser` 转成纯文本，GBK 需要它的 `full_encoding`）。邮件必须含「验证码」「verification code」「your code」这类词才算；码是离「码」「code」最近的 4～8 位数字（`123 456`、`G-123456` 也认），日期、时间、金额、手机号排除在外。都找不到时，取单独占一行的数字。是验证码邮件但认不出码时报 `unrecognized`。设置页的「认不出验证码？」（`MailCodeTester.tsx`）把粘贴的标题和正文交给 `mail_code_try` 命令，走同一套 `find_code`，另外用 `code_word` 说出是哪个词判断成验证码邮件；不读邮箱。前端只负责在原文里标出认出的码（`locateCode`）。
- **复制。** 原生层写系统剪贴板，同时加 `org.nspasteboard.ConcealedType`，让剪贴板工具不记进历史。
- **宠物的反应。** `App` 把原生事件转成总线上的 `pet.mail_code`，由 `BehaviorEngine` 处理：等待时状态行加一块「等验证码」；查到时用 `callOut` 叫醒、从边上出来、开心一下，把验证码放进常驻气泡（`codeNotice`），点掉后才回到边上；认不出、超时、失败时困惑一下，原因也放进常驻气泡。新的一次等待开始时收起上一次的结果。这是用户主动要的结果，不受勿扰限制。宠物被隐藏时，原生层在发结果前先把它显示出来。没配邮箱时报 `unset`，`App` 打开「设置 → 划词与邮箱」。
- **账号。** 地址和授权码一起以 JSON 存在钥匙串（服务名 `<identifier>.mail.163`）。保存前先登录并打开一次收件箱，成功才保存。
