# 如何新增一个动作

新增动作只需要两步：放一张图，在 `manifest.json` 里加一条。不用改任何代码。

## 示例：新增 `dance`

**第一步，放入素材。**

把图片放到资源包的 `animations` 目录：

```
public/pets/girl-default/animations/dance.png
```

素材规格见 [ASSET_GUIDE.md](./ASSET_GUIDE.md)。

**第二步，在 `public/pets/girl-default/manifest.json` 的 `animations` 数组里加一条：**

```json
{
  "id": "dance",
  "file": "animations/dance.png",
  "motion": "sway",
  "duration": 3000,
  "category": "idle",
  "priority": 5
}
```

动作可以继续用单张图片，也可以叠加透明图层。单图通过 `motion` 选择已有程序动效；组合动作在 `layers` 中声明各个叠加素材的位置、缩放、层级、帧率和动效：

```json
{
  "id": "wooden_fish",
  "file": "animations/wooden_fish_character.png",
  "layers": [
    { "file": "props/wooden_fish.png", "x": 150, "y": -18, "zIndex": 1 },
    { "file": "effects/hit_spark.png", "x": 155, "y": -110, "zIndex": 2, "motion": "pop" }
  ],
  "motion": "breathe",
  "duration": 2000,
  "priority": 30
}
```

主图和每个图层都是独立图片/横向帧表。默认从动作开始计时；显式设置 `startFrame` 后，图层动画及动效从该主图帧开始，并在主图循环时重新开始。`x`、`y` 相对于主图的底部中心锚点，单位是清单 `canvas` 的源像素；`zIndex` 越大越靠前。图层和主图共享动作时长，图层缺失会使整个动作按原有 `fallback` 规则降级。命中测试仍以主图的 `headArea` 为准，鼠标穿透区域会合并主图与所有图层的可见像素。

**第三步，验证。**

重新加载应用（开发模式下刷新即可）。因为 `category` 是 `idle`，宠物空闲时会随机跳舞。

想立刻看到效果，可以在开发模式下打开控制台（`Cmd + Option + I`）执行：

```js
__pet.requestAction("dance");
// 返回 { accepted: true, actionId: "dance" } 表示已播放
```

## 字段说明

只有 `id` 和 `file` 必填，其余都有默认值。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `id` | 必填 | 动作名，在资源包内唯一 |
| `file` | 必填 | 图片路径，相对于资源包目录。不能用绝对路径、网址或 `..` |
| `frames` | `1` | 图片里的帧数，所有帧横向等宽排成一行 |
| `layers` | `[]` | 叠加在主图上的透明素材，可单独配置位置、帧率、层级和动效 |
| `fps` | `12` | 每秒播放几帧 |
| `loop` | `false` | 是否循环播放帧。为 `true` 且不写 `duration` 时，动作一直持续到被替换 |
| `motion` | `"none"` | 程序化动效，见下表 |
| `align` | `"center"` | 水平对齐方式。`"left"` 表示图片贴着舞台左边缘，用于被墙挡住一半的画面 |
| `duration` | 见下 | 动作时长，单位毫秒 |
| `category` | `"reaction"` | 分类，决定谁会触发它，见下文 |
| `priority` | `10` | 优先级，数字越大越优先 |
| `interruptible` | `true` | 播放中能否被打断 |
| `cooldown` | 无 | 两次播放的最小间隔，单位毫秒 |
| `fallback` | 无 | 素材加载失败时改播哪个动作 |
| `pose` | 无 | 这张图该画成什么样。动作库的「用 AI 画一套新形象」会把它写进提示词；不写时只给出动作名称 |

**`duration` 不写时的规则：**

- `loop: true`：没有时长，一直播放。
- 多帧且不循环：帧数 ÷ fps。
- 单帧且不循环：1500 毫秒。

## 动效 `motion`

单帧图片靠动效动起来。多帧动画也可以叠加动效。

| 名称 | 效果 | 是否需要 `duration` |
|---|---|---|
| `none` | 不动 | 否 |
| `breathe` | 缓慢起伏，像呼吸 | 否 |
| `bounce` | 连续小跳 | 否 |
| `sway` | 左右摇晃 | 否 |
| `squash` | 快速压扁一下再恢复 | 是 |
| `wiggle` | 快速抖动并逐渐停下 | 是 |
| `pop` | 向上拉伸、回弹、稳定 | 是 |
| `tilt` | 歪向一侧再回正 | 是 |

标"是"的动效按动作进度变化，没有 `duration` 就不会动。

动效在 `src/renderer/motions.ts` 里定义。新增一种动效需要改这个文件，并把名字加到 `src/types.ts` 的 `MOTION_PRESETS`。这是唯一需要改代码的情况。

## 分类 `category`

分类决定动作由谁触发。

| 分类 | 含义 | 触发方式 |
|---|---|---|
| `idle` | 空闲时的小动作 | 宠物空闲时自动随机播放 |
| `reaction` | 对外界的反应 | 由交互或外部调用 `requestAction` 触发 |
| `system` | 和宠物状态绑定的动作 | 只能由宠物自身逻辑触发，外部调用会被拒绝 |

其他分类名也可以用，效果和 `reaction` 相同。

## 内置动作名

行为引擎会按名字请求下面这些动作。资源包里应当提供它们，缺少时按降级规则处理。

| 动作 | 触发条件 | 默认资源包的设置 |
|---|---|---|
| `idle` | 默认状态 | 优先级 0，循环，**必须提供** |
| `blink` | 空闲时随机 | 优先级 5 |
| `look_around` | 空闲时随机 | 优先级 5 |
| `think` | 聊天时等待回复 | 优先级 10 |
| `happy` | 点探头的宠物、专注完成、提醒和问候 | 优先级 20，冷却 0.5 秒 |
| `pet_reaction` | 长按宠物 0.5 秒，或右键菜单「摸摸头」 | 优先级 20，冷却 0.5 秒 |
| `shy` | 没有交互触发，只能手动播放或由 AI 选择 | 优先级 25 |
| `eat` | 喂食按钮（默认资源包已不放在 dock 上） | 优先级 30，冷却 3 秒 |
| `wooden_fish` | 木鱼按钮（默认资源包已不放在 dock 上） | 优先级 30 |
| `focus` | 专注中保持的姿势，被点击等打断后会回来 | 优先级 15，循环，`system`；默认资源包使用莲花台姿势 |
| `sleep` | 休息，或长时间无互动 | 优先级 50，循环 |
| `peek` | 拖到屏幕左右边缘后松手 | 优先级 55，循环，`align: "left"` |
| `wake_up` | 唤醒，或睡眠中被点击 | 优先级 60，不可打断 |
| `drag` | 拖动过程中 | 优先级 70，循环 |

单击宠物用来打开快速聊天，`BehaviorEngine` 只负责叫醒和从边上出来，不播反应；摸摸头改成长按（`pet.petted`）。要让新动作响应某种新的交互，需要在 `BehaviorEngine.ts` 里加一条规则。只是新增一个可播放的动作则不需要。

## 优先级和打断

新动作要打断当前动作，必须同时满足：

1. 当前动作的 `interruptible` 是 `true`。
2. 新动作的 `priority` 不低于当前动作。

例子：

- 吃东西（30）时点击身体（`happy`，20）：被拒绝，继续吃。
- 开心（20）时喂食（`eat`，30）：打断，开始吃。
- 睡觉（50）时触发眨眼（5）：被拒绝，继续睡。
- 唤醒动画（不可打断）播放中：任何请求都被拒绝。
- 贴边探头（55）时喂食（30）或休息（50）：被拒绝，要先把它点出来。
- 任何时候开始拖动（`drag`，70）：打断当前动作，唤醒动画除外。

## 降级规则

| 情况 | 结果 |
|---|---|
| 清单里有这个动作，图片也加载成功 | 正常播放 |
| 清单里有，但图片加载失败 | 播放它的 `fallback`；`fallback` 也不可用就继续往下找；最后用 `idle` |
| 清单里根本没有这个动作 | 用 `idle` |
| 连 `idle` 都没有 | 应用启动时报错 |

图片加载失败时，控制台会有一条警告，写明是哪个动作、哪个文件。

## 配置桌面快捷按钮

资源包可以通过根字段 `controls` 配置宠物悬停时显示的 Dock 按钮。「聊聊天」「提醒」「备忘」是每个角色都有的内置按钮，不在清单里，排在清单按钮前面；默认资源包的 `controls` 只有「专注」。下面是可用写法的示例：

```json
"controls": [
  { "id": "feed", "label": "喂食", "icon": "feed", "command": "feed" },
  { "id": "wooden_fish", "label": "木鱼", "icon": "wooden_fish", "command": "wooden_fish" },
  { "id": "sleep_toggle", "label": "休息", "icon": "rest", "command": "sleep_toggle" }
]
```

`icon` 可使用 `feed`、`wooden_fish`、`rest` 三种内置线性图标，也可以写成 `{ "file": "ui/feed.png" }` 使用资源包中的自定义 PNG。文件路径仍受清单校验，只能指向资源包内的相对路径。`command` 是受限的内部命令枚举，不会执行清单中的代码。当前可用命令为 `focus_toggle`、`feed`、`wooden_fish` 和 `sleep_toggle`。

资源包中的配置是默认值。普通用户可以在系统托盘或宠物右键菜单打开“设置…”，在「Dock」页修改显示名称、图标、显隐和顺序，也可以上传小于 512 KB 的 PNG/JPG/WebP 图标。用户的改动保存在本机；“恢复默认 Dock”会清除改动并回到资源包配置。

内置快捷图标包括 `feed`、`carrot`、`gift`、`wooden_fish`、`mallet`、`bell`、`rest`、`bed`、`sun`、`timer`、`hourglass`、`book`、`sparkle`、`chat`、`checklist`、`note` 和 `clipboard`。组件只允许命令枚举映射到固定事件，用户配置不能更改命令行为。

## 新增一个角色

1. 复制 `public/pets/girl-default` 为新目录，目录名只能用小写字母、数字和连字符，例如 `public/pets/cat-orange`。
2. 替换图片，修改 `manifest.json`。**`id` 必须和目录名相同**，因为本机数据按它区分角色。
3. 填写 `persona`（见下表），决定角色的默认称呼、性格和声音。
4. 把目录名加进 `public/pets/index.json` 的 `packs` 数组。「设置 → 角色」里就会出现它。

只想换名字和性格、不需要新素材时，不用改资源包：在「设置 → 角色」点“新建角色”即可，它借用内置角色的形象，动作图片可以在动作库里单独替换。

要整套换成自己的形象，在动作库顶部点「复制提示词」，连同角色参考图一起发给 ChatGPT 这类图像模型，按清单逐张生成。提示词由当前角色的动作列表和每条的 `pose` 拼成（`src/assets/ArtPrompt.ts`），用户自建的动作不在其中。新增一个需要画图的动作时，记得给它写 `pose`。

```json
"persona": {
  "name": "阿橘",
  "personality": "慵懒、爱撒娇的橘猫，说话常带“喵”",
  "voice": "苏打",
  "voiceStyle": "懒洋洋、带点撒娇的语气"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 默认称呼，最多 20 字。设置页角色列表也显示它 |
| `personality` | 否 | 默认性格描述，最多 1000 字，会拼进系统提示词 |
| `voice` | 否 | 默认朗读音色，取值见 `src/types.ts` 的 `MIMO_VOICES` |
| `voiceStyle` | 否 | 默认朗读语气，最多 200 字 |

没有 `persona` 的资源包使用内置默认值“小艾”。用户在设置页修改的名字和性格只属于当前角色，可以随时恢复为角色默认。

### 动作库显示信息

每条 `animations` 可设置 `label` 和 `description`，分别用于设置页名称和说明；省略时显示动作 ID 和默认说明。有限时长的非 `system` 动作可以加入 Dock，`idle` 类动作还可设置是否自动播放。

用户可在设置页按动作覆盖主图：选择单图、逐帧图片或横向帧图，并调整帧速、帧顺序、循环与动效。设置页也可添加或替换图片图层、调整位置、缩放、前后层级、动效和图层帧速，并按主图帧号限定显示区间。覆盖保存在本机 IndexedDB，恢复默认不修改资源包；框架仍决定触发方式、优先级及动作时长。
