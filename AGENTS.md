# AGENTS.md

本文件是 AI Pet 项目的约定，补充全局的 `AGENTS.md` / `CLAUDE.md`。全局规则（中文交流、英文代码、最小改动、先读后改）在这里不重复。

## 项目是什么

一只桌面宠物：Tauri 2 做原生窗口，React + TypeScript 写逻辑和界面，PixiJS 画角色。定位是陪用户过完每个工作日的桌面搭子。AI 请求由 `src/ai/` 组织，经原生层的模型通道（`llm.rs`）发出，不部署自有后端。

**产品方向、架构原则、做到哪一步、下一步做什么，都在 `ROADMAP.md`，开工前先读它。** 动手改代码前读 `ARCHITECTURE.md`。新增动作读 `ACTIONS.md`，处理素材读 `ASSET_GUIDE.md`。

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm tauri dev` | 启动桌面应用，前端热更新，改 Rust 会自动重新编译 |
| `pnpm dev` | 只启动前端，浏览器打开 `http://localhost:1420` |
| `pnpm exec tsc --noEmit` | 类型检查 |
| `pnpm test` | 单元测试 |
| `pnpm test:coverage` | 测试加覆盖率 |
| `pnpm eval` | 模型行为回归集：用真实的 DeepSeek 跑 `evals/chatCases.ts` 里的句子，检查调了哪些工具、结果对不对。要花一点钱，只在本机手动跑 |
| `cargo check`（在 `src-tauri/` 下） | 检查 Rust 代码 |
| `pnpm tauri build --bundles app` | 打包成 `AI Pet.app`（临时签名，钥匙串每次都会重新询问） |
| `pnpm install:app` | 用本机 Apple Development 证书签名、打包、装到 `/Applications` 并重启 |

Rust 通过 rustup 安装。新开的 shell 找不到 `cargo` 时先执行 `source "$HOME/.cargo/env"`。

## 架构上不能破的规则

1. **只有 `src/renderer/PixiRenderer.ts` 可以引用 `pixi.js`。** 其他模块通过 `PetRenderer` 接口使用渲染。
2. **只有 `src/platform/` 可以引用 `@tauri-apps/api`。** 每个函数在纯浏览器里都要能安全地什么都不做，保证 `pnpm dev` 可用。
3. **动作是数据。** 动作只来自两份数据：标准动作目录 `src/actions/standardActions.json`（每个角色都有的动作）和资源包的 `manifest.json`（这个角色画了哪些图）。不要在组件或引擎里硬编码动作参数。
4. **所有播放请求都经过 `ActionController`。** 不要绕过它直接调用渲染器。
5. **`BehaviorEngine` 只提请求、改属性。** 请求被拒绝时不改属性。
6. **React 组件只发事件。** 不直接调用控制器，不直接改状态。聊天、提醒、备忘这些场景也一样：只报告发生了什么（`pet.chat_phase`、`pet.noted`、`pet.item_done`），播哪个动作由 `BehaviorEngine` 决定，不要在入口处自己 `requestAction`。
7. **外部入口只有 `PetRuntime.requestAction()`。** 它不能改属性，也不能触发 `system` 类动作。以后的 AI、提醒都走这个入口。
8. **状态不可变。** `PetState` 的快照每次更新都生成新对象。
9. **Dock 按钮默认值来自资源包和内置列表。** 角色按钮的默认标签、顺序和图标在 `manifest.json.controls` 中配置；提醒、备忘、Claude Code、常用链接、设置是 `APP_CONTROLS`（`DockPreferences.ts`）里的内置按钮，Claude Code、常用链接和设置默认不显示（`OFF_BY_DEFAULT`）。聊天不进快捷按钮，用宠物旁边的聊天按钮（`ChatLauncher`）。设置页的改动用 Zod 校验后存本机，命令只能映射到已注册的内部事件，不能由用户配置修改。
10. **设置页与宠物窗口分离。** 设置页作为独立 Tauri 窗口运行；Tauri API 仍只能从 `src/platform/` 调用，设置 UI 通过平台封装操作窗口。
11. **模型请求只经过 `src/ai/`。** 窗口和组件只用 `ai`（`src/ai/index.ts`），不直接调 `llmPlatform`。提示词骨架、读流、工具循环、供应商的毛病都在 `src/ai/` 里，DeepSeek 特有的部分放 `src/ai/deepseek/`。宠物在聊天里能做的事是能力表（`src/skills/`）：新工具写在对应的能力文件里，或新建一个能力加进 `CHAT_SKILLS`，不要在 `chatRun.ts`、聊天窗口或快速聊天里为某个工具写特殊处理。能力按用户认得的对象分组（提醒、备忘、今日回顾……），不按动词分。新能力要写给用户看的 `title`、`summary`（「设置 › 能力」只显示这些中文）和每个工具的 `label`（「工具定义」页显示在工具名下面），不在设置组件里另起名字；在 `ICONS`（`SkillSettings.tsx`）里给它一个图标。工具名、参数、规则原文只出现在开发者模式的「提示词」「工具定义」页，不放进普通页面。用户能关掉整组，开发者能关掉单个工具；工具离不开同组别的工具（改删前先查编号）就在工具上写 `requires`。提供哪些能力、哪些工具只看 `offeredSkills` 和 `offeredTools`，不要在别处另判断开关。原生的 `llm.rs` 只管本机加密 API Key、供应商地址白名单、网络和取消，不拼提示词，也不解读回复。

12. **在宠物之外进行的事用「活动」上报。** 等验证码、以后的编码 Agent 这类事，只往总线发 `pet.activity`（`ActivityUpdate`，五个状态：`running`、`waiting`、`done`、`failed`、`cancelled`），徽标、常驻气泡和宠物的反应由 `BehaviorEngine` 统一决定。不要为一件新的事在 `BehaviorEngine` 里另加一套徽标和气泡的字段，也不要在组件里直接调平台接口去取消：点徽标只发 `pet.activity_chip_clicked`，由上报方自己处理；常驻气泡上要一个「去那里」的按钮，就在活动里带 `opens`，点了发 `pet.activity_opened`，同样由上报方处理。来自宠物窗口之外的上报先过 `activityUpdateSchema`。新的气泡图标要同时加进 `ALERT_ICONS`（`src/types.ts`）和 `PetSpeech.tsx` 里的同名表（只写 `src/ui/icons.tsx` 里的图标名）。

13. **编码会话的界面只读 `CodingSession`。** Claude Code 的钩子事件只在 `src/agents/ClaudeSessions.ts` 里解读，变成 `CodingSession`（会话）和 `ActivityUpdate`（宠物的反应）。状态卡（`CodingCard`）和面板（`CodingPanel`）只读 `codingStore` 里的会话，不读 `AgentReport`，也不自己推断状态。会话的生命周期（`ended`）和一轮对话的状态（`turn`）分开记：`Stop` 只说明这一轮结束了，界面上不能写成任务完成；很久没事件只能记成 `unknown`，不能记成做完。每一次工具调用只更新会话的 `activity`，不能产生活动（否则宠物会跟着每个工具做动作）。没有真实数据的东西（进度百分比、改了几个文件、测试结果）不显示。以后接别的 Agent（Codex）时，给它写自己的事件解读，产出同一种 `CodingSession`，`provider` 填它自己的名字。

## 界面用词

界面文字统一用下表左列的叫法，代码标识符不动（代码里仍是 dock、today/agenda、notes、quiet hours）。

| 统一成 | 不再用 |
|---|---|
| 快捷按钮 | Dock（指宠物脚下的按钮时）、快捷操作、快捷图标 |
| API Key | 密钥、Key |
| 钥匙串 | 系统钥匙串、macOS 钥匙串 |
| 勿扰、定时勿扰 | 免打扰时段、懂分寸、免打扰设置 |
| 宠物 | 桌宠 |
| 聊天记录 | 聊天历史 |
| 新聊天 | 新的聊天 |
| 提醒、备忘 | 事项、待办、今日、速记 |
| 已设提醒：…、已存进备忘：…、已安静：…（全角冒号） | 不带冒号的写法 |

不可撤销的操作用 `ConfirmButton`：先弹系统确认框（`src-tauri/src/alert.rs`），回车确认、Esc 取消。它只能用在设置、聊天这类普通窗口里；提醒、备忘弹层不能弹框，会激活应用。宠物窗口也不能弹框：要用户确认时，由 `BehaviorEngine` 发带 `choices` 的 `pet.alert`，在气泡里放按钮（例子是停止专注）。能撤销的用撤销条。报错只给人话，原始错误用 `console.error` 记日志。

设置窗口一页最多一屏半，不往页面末尾追加新功能。会一直变多的内容（日志、请求记录、记忆）各占一页；从别的页点进去的放进 `SUB_PAGES`，只在某个开关打开时才有的放单独的侧栏组（如 `DEVELOPER_GROUP`）。新加一页要同时改 `sections.ts`、`PAGE_ICONS`（`SettingsPage.tsx`）和 `.settings-nav__icon--*`（`SettingsPage.css`，给图标方块挑一个 `--tile-*` 系统色）。跳到另一页的行用整行加 ›（`settings-link` 加 `Chevron`），不要放「打开」按钮。行里就地执行的小文字链接（「恢复默认」）用 `ui-link`，不要用 `settings-link`：后者是整行样式，带 `width: 100%`，会把同一行的控件挤扁。

## 代码约定

- 代码、注释、日志、报错、提交信息用英文。界面上给用户看的文字用中文。
- 外部输入用 Zod 校验：清单文件和存档。
- 数值用具名常量，放在所属模块顶部，不要散落魔法数字。
- 颜色、圆角、阴影、字号只在 `src/ui/tokens.css` 定义一次，由 `src/main.tsx` 统一引入。各窗口样式表可以给它们起本地名字（`--label: var(--ui-text)`），不能写第二份取值；压在系统材质上的面板在根元素加 `ui-on-material`，换成那组半透明取值。角色素材的颜色（`--spark` 等）只属于宠物层。设置页中的预览要与桌面实际控件同步。
- 线条图标只画在 `src/ui/icons.tsx`，组件用 `<Icon name=…>`，不在组件里写 `<path>`。24 格，一个概念只画一次；线宽由 `.ui-icon` 统一给 1.7，窗口样式表只定尺寸。宠物层（快捷按钮、气泡、状态卡、快速聊天）的线宽由 `App.css` 各自保留。进度弧、进度环不算图标。
- 按钮只用 `src/ui/controls.css` 的 `.ui-button`，变体有 `--small`、`--large`、`--primary`（一个视图最多一个）、`--danger`（红字）、`--destructive`（确认时的红底）。窗口样式表只摆放它，不改它的样子。就地执行的文字链接（「恢复默认」「撤销」「去设置」）用 `.ui-link`：链接色 `--ui-link`、字重 500、默认 12 号、悬停加下划线。`controls.css` 在各窗口样式表之后引入，窗口要给链接改内边距或字号时写成 `button.ui-link.自己的类名`，否则权重不够。多行文本框用 `.ui-textarea`（`--small` 放提示词这类要细读的长文，`--large` 是工具窗口的主输入框），窗口样式表只定高度和外边距。
- 宠物窗口不显示系统的 `title` 提示框。宠物层的控件要说明，就用 `.pet-tip` 加 `data-tip`（`App.css`），不写 `title`。
- 界面动效用 `tokens.css` 里的一条曲线 `--ui-ease` 和三档时长：悬停、按下用 `--ui-duration-fast`，气泡、菜单、开关这类出现和切换用 `--ui-duration`，弹层用 `--ui-duration-slow`。不要再写零散的毫秒数和 `ease`。界面控件不用回弹曲线，活泼的动作留给角色（`motions.ts`）。一直转的（转圈、呼吸、进度弧）不在此列。
- 不用 `console.log`。可恢复的问题用 `console.warn`，真正的错误用 `console.error`；这两种会写进日志文件，所以不要把聊天原文、API Key、授权码传给它们。Rust 用 `log::warn!`、`log::error!`，不用 `eprintln!`（不进日志文件）。
- 测试文件和源码放在一起，命名 `*.test.ts`。公共夹具在 `src/testing/fixtures.ts`。
- 时间相关的逻辑直接用 `Date.now()` 和 `setTimeout`，测试里用 Vitest 的假时钟。随机数通过参数注入。

## 两处必须保持一致的地方

这些值分别写在两个文件里，改一处要同时改另一处：

| 内容 | 位置一 | 位置二 |
|---|---|---|
| 舞台留白 | `STAGE_MARGIN`（`src/platform/stageGeometry.ts`，须为命中格 4 像素的整数倍；两侧要放得下菜单栏下面头旁边的气泡） | `.pet-frame`、`.speech-area`、`.dock-area` 读取的 `--stage-*` 变量（`src/App.css`）；`STAGE_SIDE`（`src-tauri/src/lib.rs`，提醒、备忘、聊天窗口按宠物本身、不按窗口边摆，离宠物 `BESIDE_GAP`） |
| 窗口初始大小 | `tauri.conf.json` 的 `width`、`height` | 清单的 `canvas` × `scale`，宽度加两侧 `STAGE_MARGIN.side`，高度加 `top` 和 `bottom` |
| 原生事件名和命令名 | `src/platform/petWindow.ts` | `src-tauri/src/lib.rs`、`click_through.rs`、`quick_chat.rs` |
| 确认框命令、新聊天菜单事件 | `src/platform/dialog.ts` 的 `confirm_action`、`src/platform/chat.ts` 的 `pet://chat-new` | `src-tauri/src/alert.rs`、`lib.rs` 的 `NEW_CHAT_EVENT` 和 `invoke_handler` |
| 动效名 | `MOTION_PRESETS`（`src/types.ts`） | `src/renderer/motions.ts` |
| 窗口权限 | `petWindow.ts` 里调用的窗口 API | `src-tauri/capabilities/default.json` |
| 设置窗口路由 | `src-tauri/tauri.conf.json` 的 `settings` 窗口 URL | `src/main.tsx` 的 `window=settings` 路由 |
| 模型通道的命令名和事件名 | `src/platform/llm.ts`（`llm_*` 命令、`STREAM_EVENT`） | `src-tauri/src/llm.rs`、`request_log.rs`（`llm_log_*`、`llm_stats_add`）、`lib.rs` 的 `invoke_handler` 和 `.manage` |
| 请求记录的字段 | `recordStat`、`roundSchema`（`src/ai/requestLog.ts`） | `RequestStat`（`src-tauri/src/request_log.rs`）、`database.rs` 第 2 个迁移的表 |
| 模型供应商 ID | `DEEPSEEK.id`（`src/ai/provider.ts`） | `PROVIDERS`（`src-tauri/src/llm.rs`，供应商 ID 同时用于本机 API Key 文件名和加密关联数据） |
| 重复提醒的规则格式（`workdays`、`daily`、`1,3,5`，7 是周日） | `parseRepeat`（`src/agenda/Repeat.ts`） | `src/skills/memory.ts` 里 `add_reminder`、`update_reminder` 的 `repeat` 参数说明 |
| 开机启动、备份和重启命令，登录项状态值 | `src/platform/system.ts` | `src-tauri/src/system.rs`、`lib.rs` 的 `invoke_handler` |
| 回归集用的接口地址、本机 API Key 格式、工具轮数 | `ENDPOINT`、`apiKey`、`MAX_ROUNDS`（`evals/runChat.ts`） | `PROVIDERS`（`llm.rs`）、`tauri.conf.json` 的 `identifier`、`api_keys.rs` 的加密格式、`MAX_ROUNDS`（`src/ai/chatRun.ts`） |
| 记忆编号的写法（`m1`、`m2`…） | `REF_PREFIX`（`src/facts/FactStore.ts`） | `src/skills/remember.ts` 里 `replaces`、`ref` 参数说明的例子 |
| 用户动作 ID 带连字符，不能被 AI 选用 | `ID_PATTERN`（`src/actions/UserActions.ts`） | `ACTION_ID`（`src/ai/skill.ts`）不允许连字符 |
| Claude Code 状态的事件名、命令名和字段 | `src/platform/agents.ts`（`pet://agent`、`reportSchema`、`agent_turn_over`、`agent_title`、`agent_reveal`、`claude_hooks_*`）、`AGENT_EVENTS` 和 `AgentReport`（`src/types.ts`） | `src-tauri/src/agent_hooks.rs` 的 `EVENT`、`EVENTS`、`Forwarded`、`Work`、`Report`，`claude_settings.rs`，`lib.rs` 的 `invoke_handler` |
| 钩子转发的字数上限 | `MAX_TASK_CHARS`、`MAX_SUMMARY_CHARS`、`MAX_FORWARDED_CHARS`（`agent_hooks.rs`，按字符） | `reportSchema`（`src/platform/agents.ts`）和 `SESSION_LIMITS`（`src/agents/CodingSession.ts`，按 UTF-16，所以是两倍） |
| Coding 面板窗口 | `tauri.conf.json` 的 `coding` 窗口（圆角同提醒窗口）、`capabilities/default.json` | `src/main.tsx` 的 `window=coding` 路由、`lib.rs` 的 `CODING_WINDOW`、`POPOVERS` 和 `open_coding`，`petWindow.ts` 的 `OPEN_CODING_COMMAND` |
| 常用链接窗口 | `tauri.conf.json`、`capabilities/default.json` 的 `links` 窗口 | `src/main.tsx` 的 `window=links`，`lib.rs` 的 `LINKS_WINDOW`、`POPOVERS`、`open_links`、`set_links_enabled`，以及 `petWindow.ts` 的同名命令 |
| 配音窗口 | `src-tauri/src/dubbing.rs` 的 `WINDOW`、`URL`（窗口不写进 `tauri.conf.json`，打开时现建）、`capabilities/default.json` 的 `dubbing` | `src/main.tsx` 的 `window=dubbing` 路由 |
| 配音导出的命令名、格式请求头和长度上限 | `src/platform/dubbing.ts`（`set_dubbing_enabled`、`dubbing_export`、`dubbing_export_subtitles`、`dubbing_discard`、`FORMAT_HEADER`）、`MAX_EXPORT_SECONDS`（`src/dubbing/wav.ts`） | `src-tauri/src/dubbing.rs` 的 `FORMAT_HEADER`、`MAX_AUDIO_BYTES`，`lib.rs` 的 `invoke_handler` |
| 常用链接图标 | `src/platform/linkIcons.ts` 的 `link_icon_page`、`link_icon_image` | `src-tauri/src/link_icons.rs`、`lib.rs` 的 `invoke_handler` |
| 窗口伸出屏幕底部多少不用挪底栏（46px） | `--overhang`（`src/App.css`） | `FREE_OVERHANG_PX`（`src/App.tsx`，超过它底栏平时隐藏） |
| 状态行和状态卡的位置 | `STAGE_MARGIN.bottom`（132，`stageGeometry.ts`） | `.dock-area`、`.status-row`（`src/App.css`：底栏中心在脚下 33px，状态行上沿在窗口底部往上 72px）、`.coding-card` 的高度（66px） |
| Ghostty 定位终端 | `GHOSTTY`、`GHOSTTY_FOCUS`（`agent_hooks.rs`，用 Ghostty 脚本字典里 `terminal` 的 `tty`、`focus`，`tab` 的 `focused terminal` 和 `perform action "toggle_split_zoom"`，1.4.0 实测；没有文档承诺不变） | Ghostty 的 `Ghostty.sdef`；`src-tauri/Info.plist` 的 `NSAppleEventsUsageDescription`（没有它系统不弹授权） |
| 钩子和截图的 socket 位置 | `agent_hooks.rs` 的 `IDENTIFIER`（转发、`--capture` 时应用的配置还没读，拿不到；`capture.rs` 也用它） | `tauri.conf.json` 的 `identifier` |
| 截图的命令名、事件名和窗口名 | `src/platform/capture.ts`（`set_capture_enabled`、`pet://captured`） | `src-tauri/src/capture.rs` 的 `CAPTURED_EVENT`、`TARGETS`（窗口标签和 `tauri.conf.json`、`dubbing.rs` 的 `WINDOW` 一致；新加窗口要加进去）、`USAGE`，`lib.rs` 的 `invoke_handler`；`docs/USER_GUIDE.md` 里列的窗口名 |
| 打断、一轮结束、会话标题和后台叫醒的标记 | `INTERRUPT_MARK`、`TURN_END_MARK`、`TITLE_MARK`、`TITLE_FIELD` 和 `TASK_NOTIFICATION`（`agent_hooks.rs`，Claude Code 写进会话记录的原文、`subtype`、`ai-title` 行，和叫醒会话的提问开头，没有文档） | Claude Code 自己的输出；它改了这里就失效，`ARCHITECTURE.md`「Claude Code 的状态」写了失效后的表现 |
| 「短回合」的时长 | `CLAUDE_CONFIG.shortTurnMs`（`src/agents/ClaudeSessions.ts`） | `featureGuide.json`、`README.md`、`docs/USER_GUIDE.md` 里写的「半分钟」 |
| 查收验证码的命令名、事件名和结果种类 | `src/platform/mailCode.ts`（`updateSchema`）、`MailCodeUpdate`（`src/types.ts`） | `src-tauri/src/mail_code.rs` 的 `EVENT` 和各处 `json!({ "kind": … })`、`lib.rs` 的 `invoke_handler` |
| 「认不出验证码？」的长度上限 | `TRY_TEXT_LIMIT`（`src/components/settings/MailCodeTester.tsx`，按 UTF-16） | `MAX_TRY_CHARS`（`src-tauri/src/mail_code.rs`，按字符；前端的上限能保证不超） |
| 查收验证码最多等多久 | `src-tauri/src/mail_code.rs` 的 `WAIT_FOR` | `MailSettings.tsx` 脚注、`README.md` 里写的「2 分钟」 |
| 划词浮钮宽度 | `tauri.conf.json` 里 `selection-float` 窗口的 `width` | `FLOAT_WIDTH`（`src-tauri/src/translation.rs`） |
| 日志和诊断的命令名、日志行格式 | `src/platform/diagnostics.ts`、`parseLog`（`src/diagnostics/logEntries.ts`，`[日期][时间][来源][级别] 内容`、窗口名表） | `src-tauri/src/diagnostics.rs`（`log_plugin` 的 `format`、`WEBVIEW_TARGET`）、`lib.rs` 的 `invoke_handler` |
| 工作日志的命令名、字段 | `src/platform/worklog.ts`、`workLogSchema`（`src/worklog/WorkLog.ts`，文字上限 500 字，种类和来源 `[a-z_]`） | `src-tauri/src/worklog.rs`（文字上限 1000 字）、`lib.rs` 的 `invoke_handler` |
| 复制通知的事件名、读复制内容的命令名 | `src/platform/handover.ts`（`pet://copied`、`take_copied`） | `src-tauri/src/handover.rs`（`COPIED_EVENT`）、`lib.rs` 的 `invoke_handler` |
| 「刚复制」算多久 | `RECENT_COPY`（`src-tauri/src/handover.rs`） | `COPY_HINT_MS`（`src/components/QuickChat.tsx`），`QuickChatSettings.tsx` 开关说明、`docs/USER_GUIDE.md`、`README.md` 里写的「1 分钟」 |
| 节假日下载命令 | `src/platform/holidays.ts` 的 `fetch_holiday_year` | `src-tauri/src/holidays.rs`、`lib.rs` 的 `invoke_handler` |
| 弹出层关闭按钮的位置 | `tauri.conf.json` 里 `today`、`notes`、`coding`、`links`、`translation` 窗口的 `trafficLightPosition`（x 16、y 26，和标题同一行） | `--title-after-close`（`TodayPanel.css`，标题从红点后面开始）；`.coding-sidebar__title` 按它减去侧栏内边距 |
| 提醒窗口圆角 | `tauri.conf.json` 里 `today`、`notes`、`coding`、`links`、`translation` 窗口的 `windowEffects.radius` | `--radius-window`（`src/components/today/TodayPanel.css`） |
| 提醒窗口 | `tauri.conf.json` 的 `today` 窗口、`capabilities/default.json` | `src/main.tsx` 的 `window=today` 路由、`lib.rs` 的 `TODAY_WINDOW` |
| 备忘窗口 | `tauri.conf.json` 的 `notes` 窗口（圆角同提醒窗口）、`capabilities/default.json` | `src/main.tsx` 的 `window=notes` 路由、`lib.rs` 的 `NOTES_WINDOW` 和 `open_notes` |
| 快速聊天快捷键规则（必须含 ⌃ 或 ⌘、按键名） | `recordShortcut`、`KEY_CODE`（`src/preferences/QuickChatPreferences.ts`） | `parse_shortcut`（`src-tauri/src/quick_chat.rs`） |
| 服务报错的措辞 | `failureMessage`（`src/ai/provider.ts`）、`finishRun` 的审核提示（`src/ai/chatRun.ts`）、`src-tauri/src/llm.rs`、`mimo.rs`、`api_keys.rs` 返回给前端的文字 | `RULES`（`src/chat/serviceErrors.ts`）里的关键词：`not configured\|请先.*配置.*API Key`、Key 无效、模型名、本机 API Key、余额不足、过于频繁、服务繁忙、发不出去、`未能通过.*审核`、还在回复、网络/中断 |
| 朗读的字数上限 | `MAX_SPOKEN_CHARS`（`src/components/chat/spokenText.ts`，按字符） | `mimo_synthesize` 的 3000 字检查（`mimo.rs`） |
| MiMo 音色列表 | `MIMO_VOICES`（`src/types.ts`）、`PRESETS`（`VoiceSettings.tsx`，界面上的分组和男女声） | `mimo_synthesize` 里的音色名单（`mimo.rs`） |
| 克隆声音的写法（`clone:` 加 16 位小写十六进制） | `CLONED_VOICE_PREFIX`、`CLONED_VOICE_PATTERN`（`src/types.ts`）、`clonedVoiceSchema`（`src/platform/cosyvoice.ts`） | `VOICE_PREFIX`、`valid_id`（`src-tauri/src/cloned_voices.rs`） |
| 克隆模型 | `CLONE_MODELS`（`src/platform/cosyvoice.ts`）、`CLONE_MODEL_INFO`（`VoiceCloneSheet.tsx`，界面上的名字和介绍） | `MODELS`、`DEFAULT_MODEL`（`src-tauri/src/cosyvoice.rs`；只放支持给克隆声音加语气的模型，`cosyvoice-v3-plus` 不支持） |
| 克隆声音的上限 | `MAX_CLONES`（`ClonedVoiceSettings.tsx`）、`MAX_FILE_BYTES`（`VoiceCloneSheet.tsx`，3 MB 的 base64 不超过原生端上限） | `MAX_VOICES`、`MAX_SAMPLE_BASE64`（`cloned_voices.rs`；整个请求体走 curl 配置的一行，curl 限 10 MB） |
| 克隆声音的错误措辞 | `RULES` 的 `voice`（`src/chat/serviceErrors.ts`：`克隆的声音\|这段声音`） | `ensure_service_voice`（`cloned_voices.rs`）、`stream_synthesis`（`cosyvoice.rs`） |
| 快捷键禁用名单 | `RESERVED_SHORTCUTS`（`QuickChatPreferences.ts`） | `RESERVED_SHORTCUTS`（`quick_chat.rs`） |
| 专注阶段名 | `FocusPhase`（`src/behavior/FocusTimer.ts`） | `FOCUS_LABELS`（`lib.rs`） |
| 取消识别的标记 | `TRANSCRIBE_CANCELLED`（`src/components/chat/useVoiceInput.ts`） | `CANCELLED`（`mimo.rs`） |
| 动作的触发说明 | `src/actions/standardActions.json` 每个动作的 `description`（动作库里显示的「什么时候做」） | `BehaviorEngine.ts` 里请求这个动作的规则 |
| 内置角色列表 | `public/pets/index.json` 的 `packs` | `public/pets/<id>/` 目录名和清单 `id` |
| 功能一览和新功能介绍的图标、颜色 | `FEATURE_ICONS`、`FEATURE_COLORS`（`src/guide/featureIcons.ts`），`featureGuide.json`、`releaseNotes.json` 只能用这些 | `src/ui/icons.tsx` 里的同名图标、`.feature-tile--*`（`SettingsPage.css`） |
| 发布仓库 | `tauri.conf.json` 的 `plugins.updater.endpoints` | `scripts/release.sh` 的 `RELEASES_REPO` |
| 更新签名 | `tauri.conf.json` 的 `plugins.updater.pubkey` | 本机私钥 `~/.tauri/ai-pet-updater.key`（换密钥要两处一起换，旧版本的用户会收不到更新） |

## 改完之后怎么验证

每次改动至少跑：

```bash
pnpm exec tsc --noEmit && pnpm test
```

改了 Rust 再跑 `cargo check`。

改了 `src/skills/` 的规则文字、工具说明或 `src/ai/prompt.ts` 的提示词，再跑一次 `pnpm eval`。Key 默认从本机加密配置读；也可以用 `DEEPSEEK_API_KEY=… pnpm eval` 直接给。用例分两种：默认的必须每次都对；标了 `soft` 的漏了也无害（顺口提到的事没记上之类），只打印几次里对了几次，不算失败。会造成损害的（删错、照着递进来的内容做事、动用户写的记忆）不能标 `soft`。`-t 关键词` 只跑名字匹配的用例，`EVAL_RUNS=3` 每句跑三次（三次都对才算过），`EVAL_MODEL` 换模型。工具在内存里的假存储上执行，不碰本机数据。模型在实际使用中做错了什么，就把那句话加成一条用例。

**开发模式通过不代表安装包可用。** 涉及资源加载、窗口行为、原生调用的改动，必须打包后启动 `AI Pet.app` 再确认一次。

逻辑和画面可以在浏览器里验证（`pnpm dev`）。开发模式下 `window.__pet` 是运行时实例，可以在控制台调用 `__pet.requestAction("happy")`。

窗口、拖动、穿透、全屏这些只能在真实窗口里验证。验证不了的要在汇报里明说，不要写成"已验证"。

## 踩过的坑

这些都是实际出过问题的地方，改相关代码前先看。

**资源加载**

- 安装包里页面地址是 `tauri://localhost`。PixiJS 自带的 `Assets.load` 在这个协议下加载图片失败，窗口是空的。所以图片用原生 `Image` 元素加载，再交给 `Texture.from`。不要改回 `Assets.load`。

**窗口**

- 临时签名（ad hoc）每次构建都会变，钥匙串会把新包当成另一个程序，再次弹窗要密钥。`scripts/release.sh` 自动找本机的 Apple Development 证书，通过 `APPLE_SIGNING_IDENTITY` 签名。`tauri.conf.json` 里关掉了 `hardenedRuntime`：打开后麦克风要额外的 entitlement，语音输入会失效。
- macOS 不允许普通窗口浮在别的应用的全屏上方。必须是不激活应用的面板，见 `floating_panel.rs`。只设置置顶、层级、可加入所有空间都不够。
- 窗口必须先隐藏，等面板属性设好再显示。`tauri.conf.json` 里是 `"visible": false`，在 `setup` 末尾才 `show()`。
- 全局快捷键不能只用 ⌥ 或 ⌥⇧ 做修饰键。macOS 15 起这种组合能注册成功，但系统不再转发按键，表现为“按了没反应、也不报错”。
- 快速聊天要在宠物窗口里打字，但不能用 Tauri 的 `set_focus()`：它会激活整个应用，把用户正在用的应用切走。用 `floating_panel::take_keyboard`；收起时必须 `release_keyboard`，否则用户接着打的字会落到宠物窗口里。
- 界面上叫「提醒」和「备忘」，代码里沿用 `today`/`agenda` 和 `notes`。分法只看时间：有时间是提醒（`remindAt` 必填），没有时间是备忘，聊天工具和提示词都按这条规则写，不要再加没有时间的提醒。
- 「备忘」面板沿用 `TodayPanel.css` 的变量和控件，只在 `NotesPanel.css` 写不同的部分；改提醒面板的公共样式时两个面板都要看一眼。五个面板（提醒、备忘、常用链接、Claude Code、翻译）的页头是同一种（`.today-header`）：17px 标题和红点同一行、左对齐，数量用次要文字写在标题后面（`.today-header__count`），右边最多一个图标按钮或状态；第二行是主输入（新增或搜索），下面一条发丝线，列表在线下滚动。尺寸只有两档：单列的 320×440（提醒、备忘），带侧栏或宽行的 440×440（常用链接、Claude Code、翻译）。设置窗口的变量在 `SettingsPage.css` 顶部，名字和提醒面板一致。
- 「提醒」窗口用 macOS 原生 popover 材质（`tauri.conf.json` 的 `windowEffects`，窗口必须 `transparent: true`），圆角由系统画。页面的 `html`、`body`、`#root` 背景必须透明，面板只叠一层半透明底色，否则毛玻璃被盖住。这层底色必须用和 `windowEffects.radius` 相同的圆角并 `overflow: hidden`，否则四角露出直角色块，系统还会按它画出直角阴影。这几个面板的根元素都带 `ui-on-material`，文字和线条换成 `tokens.css` 里那组半透明的「材质上」取值；`TodayPanel.css` 顶部只给这些变量起本地名字，深色模式也在 `tokens.css` 里覆盖。
- 登录项用 `SMAppService.mainAppService`，只对 app 包里的程序有效。开发模式下注册会报错，所以默认打开只在安装版第一次运行时执行（`import.meta.env.DEV` 跳过），否则会把调试程序注册成登录项。
- 新的本机数据要用 `ai-pet:` 开头的 key，图片放 `AppearanceStore`，会增长的按天记录进工作日志（SQLite）。备份只收这三处，放在别处的数据导出时会漏掉。
- 判断宠物在哪块屏幕上不能用 `currentMonitor()`。拖到另一块屏幕松手时，它还会返回原来那块，宠物被限制回旧屏幕的边上。`readFrame` 用 `availableMonitors()` 加上宠物中心点自己算（`monitorUnderPet`）。
- "窗口置顶"开关不能用 Tauri 的 `set_always_on_top`，它会把层级改回普通置顶，全屏上方又不显示了。用 `floating_panel::set_on_top`。
- 托盘图标可能被 MacBook 的刘海挡住，所以右键菜单和托盘共用同一个菜单，功能要加到这个共用菜单里。
- 应用平时是 `Accessory`（没有 Dock 图标和菜单栏）。设置窗口打开时切成 `Regular`，关掉切回（`show_settings_window`、`hide_settings_window`），这样它被挡住后能用 ⌘Tab 找回来。聊天窗口没有这样做：它常开着，怕应用长期处于 `Regular` 时宠物面板盖不到别的应用的全屏上方（未验证）。新的普通窗口要先想好走哪条。
- 设置窗口打开时应用是 `Regular`，宠物仍是不激活应用的面板；在其它应用的全屏空间右键菜单前，先临时切到 `Accessory`，菜单关闭后恢复 `Regular`，否则原生菜单可能被全屏空间挡住。逻辑在 `show_pet_menu_native`。
- 右键菜单在主线程上同步弹出，菜单开着时 AppKit 的菜单循环照样处理网页发来的命令。再右键一次会在菜单里面再弹同一个菜单，`muda` 发现菜单正被占用就直接 panic，应用闪退（`RefCell already borrowed`）。`show_pet_menu` 用 `popped_up` 挡住第二次；以后在菜单开着时可能被调用的命令，都不要去动顶层的 `menu`。
- 设置窗口没有自己的标题栏（`tauri.conf.json` 的 `titleBarStyle: "Overlay"` 加 `hiddenTitle`），红绿灯压在侧栏左上角。侧栏顶部留了 40px（`.settings-sidebar::before`），列表在它下面滚动。右侧页头用 `data-tauri-drag-region="deep"`，整个页头的留白可拖动，返回按钮仍可点击。侧栏用不带值的属性，直接按在侧栏空白处才生效。拖动权限是 `core:window:allow-start-dragging`。
- 设置窗口是透明窗口，侧栏用系统自己的侧栏材质（`tauri.conf.json` 的 `transparent: true` 加 `windowEffects: sidebar`，`state` 是 `active`，窗口不在最前时也保持半透明）。页面只给内容区（`.settings-content`）和弹层上色，`html`、`body`、`.settings-page`、侧栏在安装包里都必须保持透明（`html.is-native`），否则材质被盖住；浏览器里没有材质，侧栏用 `--sidebar` 的灰色顶替。新加的整窗元素要么盖满窗口并有自己的底色（弹层），要么放进内容区。
- 设置窗口的配色：浅灰页面 `--bg`、白色分组卡片 `--group`、中性的灰（不带紫或暖色）。颜色都取自 `tokens.css`，`SettingsPage.css` 只给它们起本地名字。一个窗口只有一种强调色：侧栏选中项和主按钮用同一对颜色（`--ui-action-bg` 配 `--ui-action-text`，深色模式是浅紫底深色字），开关、链接、焦点环也是这个紫色，不用系统强调色（2026-11-24 定）；窗口不在最前时选中项变成中性灰（`html.is-inactive`，由窗口的 focus/blur 切换）。不要把卡片改成比页面深的灰：试过，灰卡片叠灰底再描边，看起来像线框图。会带人去别处的行（带 ›）在行首放一个彩色图标方块（`settings-nav__icon`）。
- 看设置窗口在安装包里的真实样子：用 `CGWindowListCopyWindowInfo` 找到本应用名为「AI Pet 设置」的窗口号，`screencapture -x -o -l <窗口号>` 只截这一个窗口。窗口没开着时截不到，也不能替用户去点菜单；可以临时把配置里它的 `visible` 改成 `true` 起一次 `pnpm tauri dev` 截图，截完改回并关掉。
- 应用菜单（`build_app_menu`）平时看不见，但 ⌘C、⌘V、⌘W、⌘Q 这些快捷键全靠它，删掉编辑菜单输入框就不能粘贴。退出必须用 `QUIT_ID`，否则会跳过退出前取消请求。

- 时间框不要用 `<input type="time">`：WebKit 的分段时间框要先点中小时或分钟那一段才能打字，用户觉得「只能上下选」。用 `TimeField`（`src/components/TimeField.tsx`），能直接打 `2230`、`22:30`，上下键调光标所在的那一段。
- dialog 插件（备份要用）会把 `window.confirm` 换成返回 Promise 的异步函数，`if (!window.confirm(...))` 永远不成立，确认框形同虚设。不要用 `window.confirm`/`window.alert`，用 `ConfirmButton`。也不要用 dialog 插件的 message 框做确认：它把第一个按钮当回车键，中文「取消」按钮不响应 Esc。
- 不同缩放的两块屏幕之间，物理坐标不能直接相减：tao 的 `cursor_position()` 按主屏缩放换算，`outer_position()` 按窗口所在屏换算。先各自除以自己的缩放变成逻辑坐标再算（`click_through.rs` 的 `cursor_in_window`、`lib.rs` 的 `beside`）。
- 「提醒」「备忘」弹出层是不激活应用的面板（`floating_panel::apply_popover`），打开用 `take_keyboard`，不要改回 `show()` 加 `set_focus()`：激活应用会把全屏应用里的用户切出全屏。提醒、备忘、常用链接、Claude Code、翻译五个面板（`POPOVERS`）可以同时开着，是常驻的 panel 不是 popover（HIG 里 popover 一次只能一个、点外面就关，有了关闭按钮又想多开，就得是 panel）：点外面、失焦都不收起，不要加回来，否则点第二个面板时第一个会被当成「点到外面」收掉。都开在宠物旁边，后开的会盖住已开着的面板时，排到它旁边一列（`lib.rs` 的 `place`，按矩形判断重叠：面板宽度不同，只比左上角会漏掉），不压宠物、不出可用区；排不下才往右下错开（`cascade`、`CASCADE_STEP`）。已经开着的再打开只拿到最前、不挪位置。面板「重新打开时」要做的事（Coding 回到最急的文件夹、提醒和备忘把光标放进输入框）挂在 `petWindow.onShown`（原生端从隐藏到显示时发 `pet://shown`）上，不要挂在窗口的 `focus` 上：几个面板来回点也会触发 `focus`，Coding 会跳回第一个文件夹，输入框会抢走刚点中的那一行。弹出层左上角是系统自己的红色关闭按钮（`tauri.conf.json` 里 `titleBarStyle: "Overlay"`），点了只隐藏（`lib.rs` 拦下 `CloseRequested`），和 Esc 一样。几种关法都走 `put_panel_away`（网页里是 `petWindow.hideSelf` 调 `hide_panel`），不要只调 `hide()`：收起拿着键盘的面板时 AppKit 会把键盘交给宠物窗口，没有别的面板开着就要让宠物 `release_keyboard`，否则用户接着打的字落进宠物窗口。⌘W 也要由网页自己接（`useCloseShortcut`，`src/components/keyboard.ts`）：面板不激活应用，应用菜单收不到在面板里按的快捷键，菜单里的「关闭窗口」对它们不起作用。黄绿两个按钮在 `apply_popover` 里隐藏，配置里也关了 `minimizable`、`maximizable`：应用平时是 `Accessory`，没有 Dock 图标，最小化后找不回来。不要自己画关闭按钮：试过右上角的 ×，那是 Windows 和网页的习惯。弹出层不在前台时红点是灰的，这是系统的样子。
- 弹出层拖动靠标题区的 `data-tauri-drag-region`（页头、标题那几个元素，侧栏空白处），不能指望系统标题栏。`titleBarStyle: "Overlay"` 下网页盖住了标题栏：面板是 key window 时（`take_keyboard` 刚打开它），按下事件交给网页，没有拖动区域就拖不动；先点一下别的窗口再回来，第一下点击不进网页、由系统当标题栏处理，又能拖了，看起来很诡异。新加的弹出层或新的页头也要带上这个属性。
- 聊天流分开处理文字与动作。只有 `play_action` 的 JSON 参数完整并匹配当前请求的枚举才提前执行，宠物窗口回报动作是否接受调度。模型漏掉文字时用本机话术，动作不补请求。动作只用真实可播的素材，专注、睡觉、贴边和控制器优先级仍然生效。
- DeepSeek 有时会把 `<budget:token_budget>…</budget:token_budget>` 或 `play_action\naction=dance` 泄露进正文。在流式回复和历史中清掉（`ReplyText`、`stripLeaked`、`takeLeakedActions`，在 `src/ai/deepseek/leaks.ts`）。正文里的调用样式只当文本处理，工具事件负责播放。
- 网络请求都走系统 curl，新加 curl 调用要带上 `crate::proxy::curl_args()`，否则从访达启动时不走系统代理。
- Rust 里不要按字节下标切用户给的字符串（`s[..7]`）：落在汉字中间就 panic，release 配置是 `panic = "abort"`，整个应用直接闪退。2.0.0-preview 粘贴「授权码abc…」就这样退出。用 `s.get(..n)`、`char_indices` 或先确认是 ASCII。
- Claude Code 的钩子执行的是宠物主程序本身（`--agent-hook claude`）。`run()` 的第一件事必须是 `agent_hooks::forward_if_hook()`（紧接着是 `capture::run_if_asked()`，同样不能往前挪别的东西），在它前面加任何东西（日志、插件、Tauri 初始化），每个钩子都会多花时间，还可能弹出 Dock 图标。转发模式永远退出码 0、不写 stdout：Claude Code 在 `Stop`、`UserPromptSubmit` 上会把 stdout 的 JSON 和退出码 2 当成指令。
- 钩子程序往 socket 写完一行就退出，应用接到连接时对端多半已经关了。macOS 对这种 socket 调 `set_read_timeout` 会报 `EINVAL`，内容其实还能读。1.16.0 把这个错误当失败丢掉了整条事件，表现为小牌出得晚、结束了还在转、多数时候根本不出。`read_line` 现在放过这个错误（`agent_hooks.rs` 有测试）；测这条通路要用真的钩子程序发，自己连上 socket 不关再写是测不出来的。
- 钩子在后台运行（`async`），事件可能晚到、乱序或到两次。`ClaudeSessions` 按钩子程序自己记的时间 `at` 排，早于这一轮开始或结束的直接丢掉。测试会话逻辑时要带上 `at` 写乱序的用例，只按到达顺序测是测不出来的。新接一个事件要想清楚它晚到时会怎样。
- 钩子现在会转发用户输入的第一行、文件名和回复的第一行。这些只能显示在界面上、存在 `ai-pet:coding-sessions:v1`，不能传给 `console.warn`/`console.error`（会进日志文件），也不能发给模型。原生端不转发命令、代码、工具输出和完整路径，改 `forwarded_line` 时保持这一点，测试 `names_a_tools_file_or_step_and_never_its_command` 守着。
- 宠物窗口里半透明的底色会透出桌面。状态卡的琥珀色底是叠在 `--ui-surface` 上的（`linear-gradient(tint, tint), surface`）；深色模式下 `--ui-warning-soft` 这类变量是带透明度的，直接当背景用卡片就成了透明的。
- 「回到终端」能精确到 Ghostty 的窗口和标签页，靠的是钩子记下的终端设备号（`controlling_tty`）。钩子程序是 Claude Code 用管道启动的，自己没有终端，`ps -o tty` 看是 `??`，要沿父进程往上找；不要改成读 stdin 的 tty。`osascript` 失败（用户拒绝了「控制 Ghostty」、终端已关）时一定要退回 `open -b`，不能让按钮点了没反应。Ghostty 的 `focus` 遇到同标签页里别的 split 被放大时会落空，脚本靠读回 `focused terminal` 发现并先取消放大，改脚本时别丢了这一步。切过去后的描边（`split_highlight.rs`）靠辅助功能读 Ghostty 聚焦的元素：窗口刚开或刚关的几秒内 Ghostty 会拿应用本身当聚焦元素，它也有位置和大小，所以只认 `AXTextArea`，不要去掉这个判断。也不要在 `osascript` 返回后立刻读一次就画：`activate` 不等 Ghostty 到前面，要换桌面空间时更晚，2.0.0-preview 以前就这样，从别的应用点「回到终端」时常常不亮，日志里也没有任何记录。现在等它成了最前的应用、位置两次读数一样再画（`settled_frame`）。脚本里只能按 ID 引用窗口、标签和终端（`window id …`、`terminal id …`）：`repeat with w in windows` 给的是按位置的引用，Ghostty 的窗口从前往后排，`focus` 一把目标窗口提到最前，同一个引用就指向了别的窗口。1.17.0 就是这样：读回焦点读的是别的窗口，以为没聚焦上，再按错的引用 `focus` 一次，最后停在原来那个窗口。弹出层是用 `take_keyboard` 拿的键盘，前台应用没变；从弹出层跳去本来就在前台的应用时，对方的 `activate` 什么也不改，键盘留在已经收起的弹出层上，要先把键盘交还出去（`hand_keyboard_back`）：只对弹出层 `release_keyboard` 不够，AppKit 会把键盘交给宠物窗口，焦点还在我们手里。2.0.0-preview-2 就这样：从 Ghostty 里点 Coding 面板跳回去，描边要等用户点一下终端才出来。测这些不要动用户现有的窗口：用 `new window with configuration`（`command` 设成 `/bin/sleep 90`）开临时窗口，在里面分屏、放大、开标签页，测完用 `close window` 关掉（`close` 是关终端的，对窗口不起作用），再列一遍窗口确认关了。
- Claude Code 在用户按 Esc 时什么钩子都不发（打断这一轮、在确认框里拒绝都一样，2.1.330 实测），`idle_prompt` 也只在正常结束后才来。打断只能靠读会话记录末尾的 `[Request interrupted by user`（`agent_turn_over`）。不要靠「几分钟没事件」判断：一个工具可以跑半小时不发事件。
- Claude 把命令或子代理放到后台后会先 `Stop`，这时不能说做完了：`Stop` 输入里的 `background_tasks` 不空就转发 `background`，这一轮记成 `background`。后台的事跑完，Claude Code 用一个 `prompt` 以 `<task-notification>` 开头的 `UserPromptSubmit` 叫醒会话（2.1.331 实测，中间没有别的钩子）。以前把它当成用户的新提问，开了新的一轮，标题是通知里剩下的那行字（带输出文件的路径）。现在转发成 `woke`、不带 `task`，接着原来那一轮。不要按 `run_in_background` 判断后台：跑满 2 分钟被自动转到后台、用户按 ⌃B 的命令都没有这个参数，`background_tasks` 才是准的。
- 163 邮箱登录后必须先发 IMAP `ID` 命令，它会先回一行 `* ID (...)` 再回 OK。`imap` 2.x 依赖的解析库认不出这一行，当成断线，界面上只显示「163 邮箱出了点问题」。所以用的是 `imap` 3.x（`mail_code.rs` 的 `log_in` 有用 163 真实回复写的测试），不要降回 2.x。
- 更新功能打包时需要私钥，所以 `createUpdaterArtifacts` 不写进 `tauri.conf.json`，只由 `release.sh` 在发布时用 `--config` 打开；写进配置文件会让没有私钥的 `pnpm install:app` 打包失败。
- 启动时恢复贴边，必须等 `App` 订阅了 `pet.dock_changed` 再发 `pet.drag_ended`。事件总线不重放，发早了引擎和渲染器已经贴边、`App` 不知道，表现为宠物在边上探头，快捷按钮却出现在离它很远的另一侧。
- 显示宠物不能用 `window.show()`：它等于 `makeKeyAndOrderFront`，宠物面板会变成 key window，用户接着打的字会落进来。用 `floating_panel::show_without_focus`（`reveal_pet`）。
- 安装包有 CSP（`tauri.conf.json`），不允许 `eval`。PixiJS 要先 `import "pixi.js/unsafe-eval"`（名字反直觉：引入它才不需要 eval）。新加外部资源或协议时要改 CSP，并打包回归图片加载。 另外 `connect-src` 不含 `data:`，`fetch(dataUrl)` 在安装包里会失败（开发模式没有 CSP，看不出来）；读图片用 `Image` 元素加载再画到 canvas。

**鼠标**

- 窗口不接收鼠标时，网页收不到任何鼠标事件，包括离开事件。菜单的显隐因此靠原生端发来的 `pet://hover`，不要改回 DOM 的悬停事件。
- 宠物窗口的样式不用 `:hover`，用 `[data-hover]`。WebKit 只在 key window 里更新 `:hover`（窗口不是 key 时鼠标移动只给滚动条），宠物面板平时不是 key window：悬停只在点过一下之后才跟手，否则停在最后点过的按钮上，表现为「悬停没反应」「移到这个按钮，亮的是另一个」；光标离开宠物后窗口穿透，`:hover` 也会一直留着。现在原生端在光标位于宠物上时发 `pet://pointer`（窗口里的坐标），`hoverMark.ts` 按坐标找到光标下的元素，给它和上层元素加 `data-hover`，光标离开宠物（`pet://hover` 为 false）就清掉。用属性不用类名：React 每次渲染会重写 `className`。试过在原生层给 webview 补一个始终生效的跟踪区、把 `mouseMoved` 转给它，`:hover` 照样不动（WebKit 在页面不活跃时只把移动交给滚动条），不要再走这条路。
- 拖动由前端自己移动窗口，不用 `startDragging()`。交给系统拖动后网页收不到松手事件。
- 拖动时窗口位置按原生光标算（`petWindow.getCursor()`），不能用 `PointerEvent.screenX/Y`。WebKit 的 `screenY` 从窗口所在那块屏幕的上沿算起，两块屏幕上下摆放时，窗口一换屏它就跳一整屏高，宠物在两块屏幕之间来回弹：看起来在闪、像有两个，也拖不过去。只判断是否开始拖（同一块屏幕上的几像素）时可以用。
- 按下之后松手事件可能丢失。移动事件里要检查左键是否还按着，否则会出现窗口粘在光标上的问题。
- 在宠物身上按下的那一次，松开前不切换穿透状态，否则拖动中途会丢事件。在别处按下的要照常切换：从别的应用拖文件过来时鼠标也一直按着，冻结了窗口就一直穿透，东西落不到宠物身上（`press_start`）。
- 宠物窗口关掉了 Tauri 自己的拖放（`tauri.conf.json` 里 `main` 的 `dragDropEnabled: false`），拖放由网页的 `drop` 事件接（`usePetDrop`）。打开它网页就收不到 `drop`。`dragover` 必须一律 `preventDefault`，要拒绝就把 `dropEffect` 设成 `none`：不 `preventDefault` 时 WebKit 会把拖来的文件当网页打开，1.15.0 就这样把宠物窗口换成了文件内容（还是乱码）。拖动途中 WebKit 给的类型不可靠（`.md` 可能是空的或 `application/octet-stream`），只拒绝确定读不了的。兜底是 `navigation_guard.rs`：所有窗口只能停在应用自己的页面上。

**提醒**

- 重复提醒的「本轮」是时间已经到了的最近一次；今天的时间没到，本轮还是上一次。所以错过的那次（勿扰、合盖）会一直算到点，直到被点掉、勾掉或下一次到点。重复提醒的 `doneAt` 存的是被勾掉的那一次，不是勾选时刻。
- 头顶的常驻气泡只有一个位置，谁占由 `BehaviorEngine.standing()` 一处决定：到点提醒排在活动前面（只让刚点的专注确认排在它前面），活动的 `done` 只说一句、不常驻，除非带 `keep`（用户还要用的结果，如验证码），它常驻但排在到点提醒后面。以前活动排在提醒前，Claude Code 的「做完了」把到点提醒挡住，宠物摇着铃，气泡却在说 Claude。点掉、回答、跳转都要先问 `standing()` 显示的是不是自己，不要再各写一遍顺序。
- 免打扰时段只管宠物主动说话，不拦提醒；只有手动勿扰和专注会把提醒压成徽标（`holdsReminders`、`advanceReminders`）。专注时宠物主动说的话在 `PetRuntime.allowProactive` 里拦掉，界面不再按专注过滤气泡：用户点出来的回应和确认气泡都要能显示。

**渲染**

- 窗口不在当前屏幕上时，网页的动画帧会暂停。这时截图画布是空的，不代表渲染坏了。
- React 严格模式会把副作用执行两次。渲染器自己创建画布并在销毁时移除，不要改成共用同一个 `canvas` 元素。
- 入场关键帧用 `translate`、`scale` 这两个独立属性，不要写 `transform`（`speech-in`、`sheet-in` 都是这样）。关键帧里的 `transform` 会整个盖掉元素自己的 `transform`：以前「互动」菜单靠 `translateX(-50%)` 居中，入场时会偏出半个身位，动画结束再跳回来。同理，快捷按钮的悬停和按下从 `--rest-y` 算起，偶数位按钮本来就高 4px，直接写死位移会让它悬停时反而下沉。
- 设置窗口的弹层（欢迎、新功能、摆位框、动作预览）共用一套入场：`scrim-in` 加 `sheet-in`，写在 `SettingsPage.css`。新弹层把类名加进那两条规则，不要各写各的。
- 一句话气泡的淡出靠 `--stay`（`PetSpeech` 传入这句话的显示时长），CSS 在到点前自己淡出；改 `SpeechQueue` 的时长算法不用动样式。系统开了「减弱动态效果」时，气泡、菜单、弹层只保留淡入淡出（在媒体查询里重新定义同名关键帧），铃铛和晃动停掉。
- 可点击区域表在动作切换、镜像、窗口大小、菜单显隐变化时都要重新发送。新增会改变画面轮廓的功能时记得触发更新。
- 宠物窗口比角色大，四周是透明留白。贴边、限制在屏幕内都按角色区域计算，窗口的留白可以伸出屏幕；气泡和 dock 用 `--visible-*` 收在屏幕可见部分。新增浮层也要放进这个可见范围。

**素材**

- 抠图会把发梢之间的背景当成角色留下来，需要单独去掉。
- 一张图里多个姿势时不要对半切，耳朵尖和伸进画面的手经常越过中线。
- 白色背景和白色衣服很难区分，生成素材时用浅灰蓝背景。

## 验证时的禁区

这台机器是用户正在使用的电脑。

- **不要发送模拟键盘事件。** 按键会落到前台应用里，可能误发消息。
- **模拟鼠标只能点宠物自己的窗口**，并且先确认窗口在当前屏幕上。不要为了测试穿透去点用户的其他窗口。
- **截图只截宠物窗口**（按窗口 ID），不要截整个屏幕。看安装版的界面优先用 `"/Applications/AI Pet.app/Contents/MacOS/ai-pet" --capture <pet|all|coding|…> 文件.png`（要用户先打开「设置 › 小工具 › 编码助手 › 让编码助手截图」）：宠物自己截，不用屏幕录制权限，鼠标在哪都不影响。截出来的是用户真实的会话和提醒，不要放进提交的文件里。
- **用浏览器自动化工具后关掉测试标签页。** 把 Chrome 带到前台会切走用户的桌面空间。

## 素材和动作

- 默认资源包在 `public/pets/girl-default/`。新增角色的步骤见 `ACTIONS.md` 的“新增一个角色”。
- 法定节假日数据来自 `chinese-days` 包，打包的部分只到发版时已公布的年份。宠物会自动下载缺的年份，但每年 11 月前后国务院公布新安排后，仍要升级一次依赖（`pnpm up chinese-days`）再打包，让离线的用户也有数据。只用它的 JSON 数据，不用它的 `isWorkday()`：那个函数分不清“周末”和“法定假日”，也不告诉你数据到哪一年。
- 用户或聊天工具改提醒、备忘，要用 `changeReminders`、`changeNotes`、`keepNote`（`src/worklog/store.ts`）并写明来源，不要直接调 `updateAgenda`、`updateNotes`、`saveNote`，否则工作日志漏记。只有不算用户操作的整理（标记已提醒、过期作废、旧数据迁移）可以直接写。数据库的表结构只能往 `database.rs` 的 `MIGRATIONS` 末尾加新脚本，不能改已经发出去的。
- 用户递来的内容（复制的文字，以后的拖放文件）发给模型时必须用 `handedMessage` 包成资料块，放在用户自己的话后面；由按钮发起、不需要改数据的回合只给 `BUTTON_SKILLS`。剪贴板只在用户点聊天按钮时读内容，平时只看变更计数和类型。
- 记忆（关于用户的事）用 `changeFacts`（`src/worklog/store.ts`）改并写明来源。来源是 `user` 的记忆模型不能改：聊天工具只认 `context.facts.learned` 里的编号，不要给用户写的那些编号；用户在设置里改过的聊天记忆就算用户写的。三者的分法：有时间要提醒的是提醒，要原样保存的资料是备忘，关于用户本人、长期成立的是记忆。模型能写进提示词的内容一律标成资料，不当指令。
- 宠物主动说的话必须走 `PetRuntime.sayProactively()`，需要宠物出来打招呼时走 `PetRuntime.greet()`，这样才会受勿扰和频率限制约束。不要直接发 `pet.say` 或 `pet.greeting`。
- 宠物自己想说的新话（问候、关心、以后的事前预告和事后问一句）不要在 `App` 或引擎里另起定时器，写成 `src/companion/occasions/` 里的一个场合，放进 `OCCASIONS`：表里靠前的优先，同一刻只说一句。`due()` 每 10 秒跑一次，只用 `Moment` 里的数据，不读慢的东西，不调模型。场合默认等用户手停下（`Moment.paused`）才说，只有「刚回来」这种过了就没有的时刻才标 `rightAway`。请模型写的场合，给它的事实只写用户做了什么，不写应用里的说法：试过把「提醒还没标完成」写进事实，模型就去念叨「提醒还挂着呢」（`occasions/reminders.ts`）。`src/companion/` 不引用 `PetRuntime`、`src/platform/` 和 `ai`，缺什么在 `CompanionPorts` 里加一个口子，由 `App` 接。
- 宠物自己说的话能被接上，靠的是 `pet.greeting`：`PetSpeech` 让这句气泡可点，`useQuickChat` 在之后 5 分钟内把打开的输入条当成回这句话。所以要让一句话能接，就走 `PetRuntime.greet()`，不要走 `sayProactively()`。这句话存进聊天记录时标 `unprompted`，不作为对话发给模型，而是由 `openingLine()` 取出、放进提示词的「你先开口的话」；别把它改成直接发一条开头的 assistant 消息（没核实过 DeepSeek 接不接受）。
- 宠物的心情不是存下来的数值，是 `src/companion/mood.ts` 由当天的事现算的（专注几轮、完成几个提醒、熬没熬夜），经 `pet.mood` 告诉 `BehaviorEngine`。要让别的东西跟着心情变，就读这个事件或 `Companion.mood()`，不要往 `PetState` 的属性里加新数值。
- 「今晚别催我」这类安静的要求存在 `ai-pet:companion-hush:v1`（`src/companion/hush.ts`），只有 `Cue.timedByUser` 的场合能穿过它。新加的场合如果是关心，标 `eases`，它才会在没人理时少说。
- 用户明确点击「预览」时，通过 `Companion.test()` 和 `PetRuntime.greetOnRequest()` 展示；这类手动预览不写入说话记录，专注时仍拒绝。
- 定时早安只在设定时间后的问候窗口内、检测到最近 60 秒有用户活动时触发；勿扰时段会延后早安问候。
- 属于某个角色的本机数据必须用 `characterKey(packId, name)` 生成 key，并在 `CHARACTER_DATA` 中登记；只有真正全局的设置才用固定 key。
- 设置页和聊天窗口里显示角色的图片，要用 `characterPictures`（`src/appearance/characterPictures.ts`）取图，不要直接用 `resolveAsset(action.file)` 或 `actionImages(pack)`：那样会漏掉用户换过的图，自建角色还会显示被借用角色的样子。
- 新增动作：放图片，在 `manifest.json` 的 `animations` 里加一条。不需要改代码。每个角色都该有的动作加进标准动作目录，写好 `tier`、`pose` 和 `fallback`；没有这张图的角色会自动借图，所以引擎可以直接按名字请求，不用判断有没有图。
- 上传的动作图经过摆位框，按舞台像素保存（`src/appearance/stagePlacement.ts`）。不要再按图片外框把它缩放进某个尺寸：举手、躺下的外框和站姿不同，按外框缩放会让角色忽大忽小。默认摆位要等待机图读完再算（`guideReady`），否则会按兜底规则摆错。
- 不要假设角色画全了动作。自建角色可能只有一张待机图，其余都是借图（`src/appearance/looks.ts`）。只有 `requiresArt` 的动作（目前是 `peek`）会因为没图而不能播，用到它的地方要看请求结果里的 `actionId`。
- 新增动效：改 `src/renderer/motions.ts` 和 `src/types.ts` 的 `MOTION_PRESETS`。会让整个宠物移动的动效（跳、晃、抖）要加进 `TRAVELLING`，系统开了「减弱动态效果」时会去掉。
- 行为引擎按名字使用的动作见 `ACTIONS.md` 的"内置动作名"。改名要同步改 `BehaviorEngine.ts`。
- `wake_up` 不可被控制器动作请求打断。提醒、问候、摸摸头、备忘反应和快捷动作要在 `BehaviorEngine` 中等它结束后再请求；拖动是直接用户操作，开始拖动时先停止唤醒动作。提醒、问候也要在更高优先级动作结束后补播，拖动时到点则松手后再呼叫。
- 拖动可打断专注姿势，但不能改动专注计时；松手时在 `BehaviorEngine.onDragEnded()` 立即 `settle()`，恢复专注或思考姿势，避免等下一次 tick 闪回待机动作。
- 动作播放次数只从 `pet.action.started` 统计，不能数 `requestAction()` 的请求数：控制器可能因冷却、优先级、图片降级拒绝或替换动作。统计键按角色登记在 `CHARACTER_DATA`，只记本版本之后实际开始的播放。

## 文档要跟着改

改了行为、事件、清单字段或素材，同步更新对应文档：

| 改了什么 | 更新哪份 |
|---|---|
| 用户能感知的行为、命令、限制 | `README.md` |
| 用户能用的功能：新增、改名、去掉，或者换了用法 | `src/guide/featureGuide.json`（「设置 → 功能一览」，每条写清做什么、怎么用、在哪一页设置） |
| 设置页新加或改名的行、分组标题 | `SETTINGS_INDEX`（`src/components/settings/settingsSearch.ts`，带上用户可能搜的词）；不该被搜到的放 `SEARCH_SKIPPED`。漏了测试会失败 |
| 发新版本 | `src/update/releaseNotes.json` 加这一版的新功能（没有测试会失败） |
| 模块、事件、调度规则、属性数值 | `ARCHITECTURE.md` |
| 清单字段、内置动作、优先级 | `ACTIONS.md` |
| 快捷按钮图标规格 | `ASSET_GUIDE.md` |
| 素材规格、当前素材清单、制作流程 | `ASSET_GUIDE.md` |
| 新的约定或新踩的坑 | `AGENTS.md` |

## 当前阶段不做的事

后端服务、账号、多端同步、成长系统、商城、骨骼动画、状态管理库。不要为将来可能的需求提前加抽象。
