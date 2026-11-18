# AGENTS.md

本文件是 AI Pet 项目的约定，补充全局的 `AGENTS.md` / `CLAUDE.md`。全局规则（中文交流、英文代码、最小改动、先读后改）在这里不重复。

## 项目是什么

一只桌面宠物：Tauri 2 做原生窗口，React + TypeScript 写逻辑和界面，PixiJS 画角色。第一阶段的交互引擎已完成；第二阶段 DeepSeek 文字聊天已接入；第三阶段正在接入 MiMo 语音输入和输出。AI 请求目前在桌面原生层处理，不部署自有后端。

动手前先读 `ARCHITECTURE.md`。新增动作读 `ACTIONS.md`，处理素材读 `ASSET_GUIDE.md`。

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm tauri dev` | 启动桌面应用，前端热更新，改 Rust 会自动重新编译 |
| `pnpm dev` | 只启动前端，浏览器打开 `http://localhost:1420` |
| `pnpm exec tsc --noEmit` | 类型检查 |
| `pnpm test` | 单元测试 |
| `pnpm test:coverage` | 测试加覆盖率 |
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
9. **Dock 按钮默认值来自资源包和内置列表。** 角色按钮的默认标签、顺序和图标在 `manifest.json.controls` 中配置；聊聊天、提醒、备忘是 `APP_CONTROLS`（`DockPreferences.ts`）里的内置按钮。设置页的改动用 Zod 校验后存本机，命令只能映射到已注册的内部事件，不能由用户配置修改。
10. **设置页与宠物窗口分离。** 设置页作为独立 Tauri 窗口运行；Tauri API 仍只能从 `src/platform/` 调用，设置 UI 通过平台封装操作窗口。

## 界面用词

界面文字统一用下表左列的叫法，代码标识符不动（代码里仍是 dock、today/agenda、notes、quiet hours）。

| 统一成 | 不再用 |
|---|---|
| 快捷按钮 | Dock（指宠物两侧的按钮时）、快捷操作、快捷图标 |
| API Key | 密钥、Key |
| 钥匙串 | 系统钥匙串、macOS 钥匙串 |
| 勿扰、定时勿扰 | 免打扰时段、懂分寸、免打扰设置 |
| 宠物 | 桌宠 |
| 聊天记录 | 聊天历史 |
| 新聊天 | 新的聊天 |
| 提醒、备忘 | 事项、待办、今日、速记 |
| 已设提醒：…、已存进备忘：…（全角冒号） | 不带冒号的写法 |

不可撤销的操作用 `ConfirmButton`：先弹系统确认框（`src-tauri/src/alert.rs`），回车确认、Esc 取消。它只能用在设置、聊天这类普通窗口里；提醒、备忘弹层不能弹框，会激活应用。宠物窗口也不能弹框：要用户确认时，由 `BehaviorEngine` 发带 `choices` 的 `pet.alert`，在气泡里放按钮（例子是停止专注）。能撤销的用撤销条。报错只给人话，原始错误用 `console.error` 记日志。

## 代码约定

- 代码、注释、日志、报错、提交信息用英文。界面上给用户看的文字用中文。
- 外部输入用 Zod 校验：清单文件和存档。
- 数值用具名常量，放在所属模块顶部，不要散落魔法数字。
- 不用 `console.log`。可恢复的问题用 `console.warn`，真正的错误用 `console.error`。
- 测试文件和源码放在一起，命名 `*.test.ts`。公共夹具在 `src/testing/fixtures.ts`。
- 时间相关的逻辑直接用 `Date.now()` 和 `setTimeout`，测试里用 Vitest 的假时钟。随机数通过参数注入。

## 两处必须保持一致的地方

这些值分别写在两个文件里，改一处要同时改另一处：

| 内容 | 位置一 | 位置二 |
|---|---|---|
| 舞台留白 | `STAGE_MARGIN`（`src/platform/stageGeometry.ts`，须为命中格 4 像素的整数倍） | `.pet-frame`、`.speech-area`、`.dock-area` 读取的 `--stage-*` 变量（`src/App.css`） |
| 窗口初始大小 | `tauri.conf.json` 的 `width`、`height` | 清单的 `canvas` × `scale`，宽度加两侧 `STAGE_MARGIN.side`，高度加 `top` 和 `bottom` |
| 原生事件名和命令名 | `src/platform/petWindow.ts` | `src-tauri/src/lib.rs`、`click_through.rs`、`quick_chat.rs` |
| 确认框命令、新聊天菜单事件 | `src/platform/dialog.ts` 的 `confirm_action`、`src/platform/chat.ts` 的 `pet://chat-new` | `src-tauri/src/alert.rs`、`lib.rs` 的 `NEW_CHAT_EVENT` 和 `invoke_handler` |
| 动效名 | `MOTION_PRESETS`（`src/types.ts`） | `src/renderer/motions.ts` |
| 窗口权限 | `petWindow.ts` 里调用的窗口 API | `src-tauri/capabilities/default.json` |
| 设置窗口路由 | `src-tauri/tauri.conf.json` 的 `settings` 窗口 URL | `src/main.tsx` 的 `window=settings` 路由 |
| 性格长度上限 | `PERSONA_LIMITS.personality`（`src/types.ts`） | `MAX_PERSONALITY_CHARS`（`src-tauri/src/chat.rs`） |
| 聊天补充要求长度上限（UTF-16） | `CHAT_INSTRUCTIONS_LIMIT`（`src/preferences/ChatInstructions.ts`） | `MAX_CHAT_INSTRUCTIONS_CHARS`（`src-tauri/src/chat.rs`） |
| 你的称呼长度上限 | `USER_PROFILE_LIMITS.nickname`（`src/preferences/UserProfile.ts`） | `MAX_USER_NAME_CHARS`（`src-tauri/src/chat.rs`） |
| 聊天工具名、提醒和备忘长度上限、动作名格式 | `src/agenda/chatTools.ts`、`AGENDA_LIMITS.text`、`NOTE_LIMITS.text`（`src/notes/NoteStore.ts`） | `src-tauri/src/chat.rs` 的 `ADD_REMINDER_TOOL`、`SAVE_NOTE_TOOL`、`PLAY_ACTION_TOOL`、`MAX_ITEM_CHARS`、`MAX_NOTE_CHARS`、`valid_action_id` |
| 重复提醒的规则格式（`workdays`、`daily`、`1,3,5`，7 是周日） | `parseRepeat`（`src/agenda/Repeat.ts`） | `chat.rs` 里 `add_reminder` 的 `repeat` 参数说明 |
| 开机启动、备份和重启命令，登录项状态值 | `src/platform/system.ts` | `src-tauri/src/system.rs`、`lib.rs` 的 `invoke_handler` |
| 用户动作 ID 带连字符，不能被 AI 选用 | `ID_PATTERN`（`src/actions/UserActions.ts`） | `ACTION_ID_PATTERN`（`src/agenda/chatTools.ts`）不允许连字符 |
| 查收验证码的命令名、事件名和结果种类 | `src/platform/mailCode.ts`（`updateSchema`）、`MailCodeUpdate`（`src/types.ts`） | `src-tauri/src/mail_code.rs` 的 `EVENT` 和各处 `json!({ "kind": … })`、`lib.rs` 的 `invoke_handler` |
| 「认不出验证码？」的长度上限 | `TRY_TEXT_LIMIT`（`src/components/settings/MailCodeTester.tsx`，按 UTF-16） | `MAX_TRY_CHARS`（`src-tauri/src/mail_code.rs`，按字符；前端的上限能保证不超） |
| 查收验证码最多等多久 | `src-tauri/src/mail_code.rs` 的 `WAIT_FOR` | `MailSettings.tsx` 脚注、`README.md` 里写的「2 分钟」 |
| 节假日下载命令 | `src/platform/holidays.ts` 的 `fetch_holiday_year` | `src-tauri/src/holidays.rs`、`lib.rs` 的 `invoke_handler` |
| 提醒窗口圆角 | `tauri.conf.json` 里 `today` 窗口的 `windowEffects.radius` | `--radius-window`（`src/components/today/TodayPanel.css`） |
| 提醒窗口 | `tauri.conf.json` 的 `today` 窗口、`capabilities/default.json` | `src/main.tsx` 的 `window=today` 路由、`lib.rs` 的 `TODAY_WINDOW` |
| 备忘窗口 | `tauri.conf.json` 的 `notes` 窗口（圆角同提醒窗口）、`capabilities/default.json` | `src/main.tsx` 的 `window=notes` 路由、`lib.rs` 的 `NOTES_WINDOW` 和 `open_notes` |
| 快速聊天快捷键规则（必须含 ⌃ 或 ⌘、按键名） | `recordShortcut`、`KEY_CODE`（`src/preferences/QuickChatPreferences.ts`） | `parse_shortcut`（`src-tauri/src/quick_chat.rs`） |
| 服务报错的措辞 | `src-tauri/src/chat.rs` 的 `failure_message`、`mimo.rs`、`secrets.rs` 的 `keychain_error` 返回给前端的文字 | `RULES`（`src/chat/serviceErrors.ts`）里的关键词：`not configured\|请先.*配置.*API Key`、Key 无效、模型名、钥匙串、余额不足、过于频繁、服务繁忙、发不出去、还在回复、网络/中断 |
| 角色名长度上限 | `PERSONA_LIMITS.name`（`src/types.ts`） | `read_preferences` 里的 20（`src-tauri/src/chat.rs`） |
| 发给模型的消息条数 | `CHAT_LIMITS.context`（`src/chat/ChatThreads.ts`，保存和显示的上限是另一个值 `CHAT_LIMITS.messages`） | `start_request` 里的 `items.len() > 30`（`chat.rs`） |
| 单条消息长度 | `MAX_MESSAGE_CHARS`（`ChatThreads.ts`，按 UTF-16 长度） | `chat.rs` 的 `content.len() > 16_000`（按字节，单位不同：中文 16000 字节约 5000 字） |
| 聊天模型 | `DEFAULT_CHAT_MODEL`、`CHAT_MODEL_PATTERN`（`src/preferences/ChatModel.ts`） | `DEFAULT_MODEL`、`valid_model`（`chat.rs`） |
| 一次回复的工具调用上限 | `MAX_CALLS_SHOWN`（`src/agenda/chatTools.ts`） | `MAX_TOOL_CALLS`（`chat.rs`） |
| MiMo 音色列表 | `MIMO_VOICES`（`src/types.ts`） | `mimo_synthesize` 里的音色名单（`mimo.rs`） |
| 快捷键禁用名单 | `RESERVED_SHORTCUTS`（`QuickChatPreferences.ts`） | `RESERVED_SHORTCUTS`（`quick_chat.rs`） |
| 专注阶段名 | `FocusPhase`（`src/behavior/FocusTimer.ts`） | `FOCUS_LABELS`（`lib.rs`） |
| 取消识别的标记 | `TRANSCRIBE_CANCELLED`（`src/components/chat/useVoiceInput.ts`） | `CANCELLED`（`mimo.rs`） |
| 动作的触发说明 | `src/actions/standardActions.json` 每个动作的 `description`（动作库里显示的「什么时候做」） | `BehaviorEngine.ts` 里请求这个动作的规则 |
| 内置角色列表 | `public/pets/index.json` 的 `packs` | `public/pets/<id>/` 目录名和清单 `id` |
| 发布仓库 | `tauri.conf.json` 的 `plugins.updater.endpoints` | `scripts/release.sh` 的 `RELEASES_REPO` |
| 更新签名 | `tauri.conf.json` 的 `plugins.updater.pubkey` | 本机私钥 `~/.tauri/ai-pet-updater.key`（换密钥要两处一起换，旧版本的用户会收不到更新） |

## 改完之后怎么验证

每次改动至少跑：

```bash
pnpm exec tsc --noEmit && pnpm test
```

改了 Rust 再跑 `cargo check`。

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
- 「备忘」面板沿用 `TodayPanel.css` 的变量和控件，只在 `NotesPanel.css` 写不同的部分；改提醒面板的公共样式时两个面板都要看一眼。设置窗口的变量在 `SettingsPage.css` 顶部，名字和提醒面板一致。
- 「提醒」窗口用 macOS 原生 popover 材质（`tauri.conf.json` 的 `windowEffects`，窗口必须 `transparent: true`），圆角由系统画。页面的 `html`、`body`、`#root` 背景必须透明，面板只叠一层半透明底色，否则毛玻璃被盖住。这层底色必须用和 `windowEffects.radius` 相同的圆角并 `overflow: hidden`，否则四角露出直角色块，系统还会按它画出直角阴影。样式用 `TodayPanel.css` 顶部的变量（圆角：行 8、控件 6；焦点环：强调色描边加 3px 光圈），深色模式在同一处覆盖。
- 登录项用 `SMAppService.mainAppService`，只对 app 包里的程序有效。开发模式下注册会报错，所以默认打开只在安装版第一次运行时执行（`import.meta.env.DEV` 跳过），否则会把调试程序注册成登录项。
- 新的本机数据要用 `ai-pet:` 开头的 key，图片放 `AppearanceStore`。备份只收这两处，放在别处的数据导出时会漏掉。
- 判断宠物在哪块屏幕上不能用 `currentMonitor()`。拖到另一块屏幕松手时，它还会返回原来那块，宠物被限制回旧屏幕的边上。`readFrame` 用 `availableMonitors()` 加上宠物中心点自己算（`monitorUnderPet`）。
- "窗口置顶"开关不能用 Tauri 的 `set_always_on_top`，它会把层级改回普通置顶，全屏上方又不显示了。用 `floating_panel::set_on_top`。
- 托盘图标可能被 MacBook 的刘海挡住，所以右键菜单和托盘共用同一个菜单，功能要加到这个共用菜单里。
- 应用平时是 `Accessory`（没有 Dock 图标和菜单栏）。设置窗口打开时切成 `Regular`，关掉切回（`show_settings_window`、`hide_settings_window`），这样它被挡住后能用 ⌘Tab 找回来。聊天窗口没有这样做：它常开着，怕应用长期处于 `Regular` 时宠物面板盖不到别的应用的全屏上方（未验证）。新的普通窗口要先想好走哪条。
- 应用菜单（`build_app_menu`）平时看不见，但 ⌘C、⌘V、⌘W、⌘Q 这些快捷键全靠它，删掉编辑菜单输入框就不能粘贴。退出必须用 `QUIT_ID`，否则会跳过退出前取消请求。

- dialog 插件（备份要用）会把 `window.confirm` 换成返回 Promise 的异步函数，`if (!window.confirm(...))` 永远不成立，确认框形同虚设。不要用 `window.confirm`/`window.alert`，用 `ConfirmButton`。也不要用 dialog 插件的 message 框做确认：它把第一个按钮当回车键，中文「取消」按钮不响应 Esc。
- 不同缩放的两块屏幕之间，物理坐标不能直接相减：tao 的 `cursor_position()` 按主屏缩放换算，`outer_position()` 按窗口所在屏换算。先各自除以自己的缩放变成逻辑坐标再算（`click_through.rs` 的 `cursor_in_window`、`lib.rs` 的 `beside`）。
- 「提醒」「备忘」弹出层是不激活应用的面板（`floating_panel::apply_popover`），打开用 `take_keyboard`，不要改回 `show()` 加 `set_focus()`：激活应用会把全屏应用里的用户切出全屏。
- 只调用 `play_action` 的回复没有任何文字，前端只能显示「没有收到回复」。原生端遇到这种回复会去掉工具再请求一次（`needs_words`、`words_request`，在 `chat.rs`）。新加只做事、不产生文字的工具时，也要算进 `needs_words`。不要在提示词里写「动作不能代替回复」这类话：试过，模型会改成用括号描写动作（「（敲敲木鱼）」），不再调用工具，宠物就不动了。
- 网络请求都走系统 curl，新加 curl 调用要带上 `crate::proxy::curl_args()`，否则从访达启动时不走系统代理。
- 163 邮箱登录后必须先发 IMAP `ID` 命令，它会先回一行 `* ID (...)` 再回 OK。`imap` 2.x 依赖的解析库认不出这一行，当成断线，界面上只显示「163 邮箱出了点问题」。所以用的是 `imap` 3.x（`mail_code.rs` 的 `log_in` 有用 163 真实回复写的测试），不要降回 2.x。
- 更新功能打包时需要私钥，所以 `createUpdaterArtifacts` 不写进 `tauri.conf.json`，只由 `release.sh` 在发布时用 `--config` 打开；写进配置文件会让没有私钥的 `pnpm install:app` 打包失败。
- 启动时恢复贴边，必须等 `App` 订阅了 `pet.dock_changed` 再发 `pet.drag_ended`。事件总线不重放，发早了引擎和渲染器已经贴边、`App` 不知道，表现为宠物在边上探头，快捷按钮却出现在离它很远的另一侧。
- 显示宠物不能用 `window.show()`：它等于 `makeKeyAndOrderFront`，宠物面板会变成 key window，用户接着打的字会落进来。用 `floating_panel::show_without_focus`（`reveal_pet`）。
- 安装包有 CSP（`tauri.conf.json`），不允许 `eval`。PixiJS 要先 `import "pixi.js/unsafe-eval"`（名字反直觉：引入它才不需要 eval）。新加外部资源或协议时要改 CSP，并打包回归图片加载。 另外 `connect-src` 不含 `data:`，`fetch(dataUrl)` 在安装包里会失败（开发模式没有 CSP，看不出来）；读图片用 `Image` 元素加载再画到 canvas。

**鼠标**

- 窗口不接收鼠标时，网页收不到任何鼠标事件，包括离开事件。菜单的显隐因此靠原生端发来的 `pet://hover`，不要改回 DOM 的悬停事件。
- 拖动由前端自己移动窗口，不用 `startDragging()`。交给系统拖动后网页收不到松手事件。
- 按下之后松手事件可能丢失。移动事件里要检查左键是否还按着，否则会出现窗口粘在光标上的问题。
- 鼠标按键按下期间不切换穿透状态，否则拖动中途会丢事件。

**提醒**

- 重复提醒的「本轮」是时间已经到了的最近一次；今天的时间没到，本轮还是上一次。所以错过的那次（勿扰、合盖）会一直算到点，直到被点掉、勾掉或下一次到点。重复提醒的 `doneAt` 存的是被勾掉的那一次，不是勾选时刻。
- 免打扰时段只管宠物主动说话，不拦提醒；只有手动勿扰会把提醒压成徽标（`holdsReminders`）。

**渲染**

- 窗口不在当前屏幕上时，网页的动画帧会暂停。这时截图画布是空的，不代表渲染坏了。
- React 严格模式会把副作用执行两次。渲染器自己创建画布并在销毁时移除，不要改成共用同一个 `canvas` 元素。
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
- **截图只截宠物窗口**（按窗口 ID），不要截整个屏幕。
- **用浏览器自动化工具后关掉测试标签页。** 把 Chrome 带到前台会切走用户的桌面空间。

## 素材和动作

- 默认资源包在 `public/pets/girl-default/`。新增角色的步骤见 `ACTIONS.md` 的“新增一个角色”。
- 法定节假日数据来自 `chinese-days` 包，打包的部分只到发版时已公布的年份。宠物会自动下载缺的年份，但每年 11 月前后国务院公布新安排后，仍要升级一次依赖（`pnpm up chinese-days`）再打包，让离线的用户也有数据。只用它的 JSON 数据，不用它的 `isWorkday()`：那个函数分不清“周末”和“法定假日”，也不告诉你数据到哪一年。
- 宠物主动说的话必须走 `PetRuntime.sayProactively()`，需要宠物出来打招呼时走 `PetRuntime.greet()`，这样才会受勿扰和频率限制约束。不要直接发 `pet.say` 或 `pet.greeting`。
- 属于某个角色的本机数据必须用 `characterKey(packId, name)` 生成 key，并在 `CHARACTER_DATA` 中登记；只有真正全局的设置才用固定 key。
- 设置页和聊天窗口里显示角色的图片，要用 `characterPictures`（`src/appearance/characterPictures.ts`）取图，不要直接用 `resolveAsset(action.file)` 或 `actionImages(pack)`：那样会漏掉用户换过的图，自建角色还会显示被借用角色的样子。
- 新增动作：放图片，在 `manifest.json` 的 `animations` 里加一条。不需要改代码。每个角色都该有的动作加进标准动作目录，写好 `tier`、`pose` 和 `fallback`；没有这张图的角色会自动借图，所以引擎可以直接按名字请求，不用判断有没有图。
- 上传的动作图经过摆位框，按舞台像素保存（`src/appearance/stagePlacement.ts`）。不要再按图片外框把它缩放进某个尺寸：举手、躺下的外框和站姿不同，按外框缩放会让角色忽大忽小。默认摆位要等待机图读完再算（`guideReady`），否则会按兜底规则摆错。
- 不要假设角色画全了动作。自建角色可能只有一张待机图，其余都是借图（`src/appearance/looks.ts`）。只有 `requiresArt` 的动作（目前是 `peek`）会因为没图而不能播，用到它的地方要看请求结果里的 `actionId`。
- 新增动效：改 `src/renderer/motions.ts` 和 `src/types.ts` 的 `MOTION_PRESETS`。会让整个宠物移动的动效（跳、晃、抖）要加进 `TRAVELLING`，系统开了「减弱动态效果」时会去掉。
- 行为引擎按名字使用的动作见 `ACTIONS.md` 的"内置动作名"。改名要同步改 `BehaviorEngine.ts`。

## 文档要跟着改

改了行为、事件、清单字段或素材，同步更新对应文档：

| 改了什么 | 更新哪份 |
|---|---|
| 用户能感知的行为、命令、限制 | `README.md` |
| 模块、事件、调度规则、属性数值 | `ARCHITECTURE.md` |
| 清单字段、内置动作、优先级 | `ACTIONS.md` |
| 快捷按钮图标规格 | `ASSET_GUIDE.md` |
| 素材规格、当前素材清单、制作流程 | `ASSET_GUIDE.md` |
| 新的约定或新踩的坑 | `AGENTS.md` |

## 当前阶段不做的事

后端服务、账号、多端同步、成长系统、商城、骨骼动画、状态管理库。不要为将来可能的需求提前加抽象。
