# AI Pet

一只住在 Mac 桌面上的 2D 宠物。点一下就能聊两句，忙的时候陪你专注，到点叫你一声。

![封面插画：蓝白配色的小祭司坐在桌边，身旁放着铃铛和茶杯](./docs/images/readme-cover.jpg)

**[下载 macOS 版](https://github.com/lance2016/desk-ai-pet/releases)** · [使用指南](./docs/USER_GUIDE.md) · [本地开发](#本地开发) · [项目架构](./ARCHITECTURE.md)

## 它能做什么

| 功能 | 体验 |
| --- | --- |
| **桌面互动** | 长按摸摸头，拖到屏幕边缘看它探头。离开一会儿它会睡觉，回来继续陪你。 |
| **AI 聊天** | 用 DeepSeek 流式聊天，文字和动作可以同时出现。完整聊天支持读链接、联网搜索和图片，MiMo 支持语音转文字。 |
| **提醒与备忘** | 说「明早九点提醒我开会」或「记一下要买牛奶」，也能说「把三点的会改到四点」「把牛奶那条删了」，改错了点「撤销」。工作日提醒支持法定节假日和调休，也可以用今日回顾整理当天记录。 |
| **专注与陪伴** | 25 分钟专注、5 分钟休息。支持早晚问候、连续使用提醒和定时勿扰。 |
| **桌面小工具** | 划词后翻译、解释、总结或润色，也能查收 163 邮箱的验证码。 |
| **自定义角色** | 换形象和性格，编辑多帧动作、动效及图层，导入和导出自己的角色包。 |

## 安装与上手

1. 在 [GitHub Releases](https://github.com/lance2016/desk-ai-pet/releases) 下载适合你 Mac 芯片的 ZIP。解压后把 `AI Pet.app` 拖进「应用程序」，然后打开。系统要求 **macOS 13 或更新版本**。
2. **点一下宠物**打开快速聊天，默认全局快捷键为 `⇧⌘ Space`。右键宠物或点击菜单栏图标，可打开完整聊天、提醒、备忘和设置。
3. 在「设置 → AI 对话」填入自己的 **DeepSeek API Key**。要用语音输入，在「设置 → 语音」填入 **MiMo API Key**。桌面互动、手动提醒和专注可直接使用。

更多入口可在「设置 → 功能一览」查看。已安装的用户可在「设置 → 关于 → 软件更新」检查新版。

## 数据与隐私

API Key 保存在 macOS 钥匙串。聊天记录、提醒和备忘保存在本机，可在「设置 → 隐私与数据 → 备份」导出或恢复。

AI 功能会把当前任务所需内容发送给对应服务。发送聊天可能附带近期对话，语音识别会把录音发给 MiMo，划词处理在点选操作后才把选中文字发给 DeepSeek。详见[使用指南](./docs/USER_GUIDE.md)。

## 本地开发

项目使用 **Tauri 2 / Rust** 管理原生窗口和系统能力，**React / TypeScript** 编写界面和宠物逻辑，**PixiJS 8** 渲染角色。

准备 Node.js **24.x**、pnpm 9+、[Rust stable](https://rustup.rs) 和 Xcode Command Line Tools。

```bash
pnpm install
pnpm tauri dev
```

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 在浏览器调试前端，默认地址是 `http://localhost:1420` |
| `pnpm test` | 运行前端单元测试 |
| `pnpm build` | 类型检查并构建前端 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 运行 Rust 测试 |
| `pnpm tauri build --bundles app` | 构建 macOS 应用包 |
| `pnpm install:app` | 测试、打包、安装到「应用程序」并重启 AI Pet |

全屏浮层、鼠标穿透和全局快捷键需要在 macOS 应用窗口中验证。

<details>
<summary>维护者发布流程</summary>

1. 同步更新 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 中的版本，并补充 [版本说明](./src/update/releaseNotes.json)。
2. 提交并推送。登录 GitHub CLI，并准备与应用更新公钥配对的私钥，默认路径为 `~/.tauri/ai-pet-updater.key`，可通过 `AI_PET_UPDATER_KEY` 指定。
3. 运行 `pnpm release`。脚本会打包并安装本机版本，再发布 GitHub Release 和已签名的更新包。

发布脚本与产物约定见 [scripts/release.sh](./scripts/release.sh)。

</details>

## 更多文档

- [架构说明](./ARCHITECTURE.md) · 宠物运行时、动作调度与原生窗口
- [动作配置](./ACTIONS.md) · 内置动作、资源包和优先级
- [素材指南](./ASSET_GUIDE.md) · 角色形象、逐帧动画与图层
- [项目路线图](./ROADMAP.md) · 长期记忆、工作台和更多桌面集成
