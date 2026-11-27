---
id: ai-editing
title: AI 编辑
sidebar_position: 8
description: "用你自己的 AI 代理编辑 OpenScreen 项目：Claude Code、Codex 或任何 MCP 客户端启动 `openscreen mcp`，即可录制、编辑、转录和导出。应用中没有提供方，也没有密钥。"
keywords:
  - AI 视频剪辑
  - MCP 视频编辑器
  - Claude Code 视频编辑
  - Codex 视频编辑
  - 隐私
---

# AI 编辑

OpenScreen 没有自己的模型，应用中也没有可连接的模型。AI 编辑由你已经在用的 AI 代理完成，例如 Claude Code 或 Codex：它启动 `openscreen mcp`，也就是 OpenScreen 的 MCP 服务器，并通过其中的工具工作。AI 代理用自己的账号登录，OpenScreen 永远看不到这个账号。OpenScreen 自身不会向任何模型发送任何内容：AI 代理通过这些工具读取的内容，例如项目、转录文本和静态帧，会在你在该代理处的账号下，发送给该代理的提供方。应用自身的网络用途（下载转录模型、检查更新）列在[常见问题](./faq.md#does-openscreen-work-offline)中。

:::tip
以上这些都不是必需的。录制、编辑、转录、字幕和导出都无需账号、无需 AI 代理即可使用。其中只有转录需要下载一次：首次运行时下载的[转录模型](./captions.md#transcribing)。
:::

:::note
早期版本的编辑器中有一个聊天面板，用你自己的 API 密钥连接模型提供方；应用的设置中还有一个需要手动开启的 MCP 服务器。两者都已移除，依赖该密钥运行的两项功能也一并移除：字幕面板中的**翻译**按钮，以及时间轴**自动增强**菜单中的**智能剪切**。这些工作现在由你自己的 AI 代理通过本页介绍的工具完成。
:::

## 设置 {#setting-it-up}

应用中没有任何需要开启的东西：无需端口、令牌或设置。AI 代理以你的权限，用 `mcp` 启动应用自身的可执行文件，并通过 stdin 和 stdout 与它通信，就像它运行 `openscreen record` 一样。因此，无需在应用中授予任何许可，它就能录制你的屏幕、进行编辑和导出。最快的方式是把下面这段内容粘贴到你的 AI 代理（Claude Code、Codex、Cursor 等）中：

```text
Install the OpenScreen skills with `npx skills add getopenscreen/openscreen -y`, then follow openscreen-demo to make a demo video of this feature.
```

如果缺少 OpenScreen，这些技能会在你同意后安装它。以这种方式安装、且不使用下面的插件时，`openscreen-demo` 技能会添加 OpenScreen 的 MCP 服务器，随后请你打开一个新会话，并说出 *continue the OpenScreen demo*：AI 代理只有在新会话中才能获得新工具。若要改为手动设置：

```bash
claude mcp add openscreen -- "<executable>" mcp
codex mcp add openscreen -- "<executable>" mcp
```

`<executable>` 是应用的可执行文件，各系统上的路径列在[运行 CLI](./cli.md#running-the-cli)中。其他客户端（例如 Cursor）以 stdio 服务器的方式添加：可执行文件作为 `command`，`["mcp"]` 作为 `args`。

这些技能也以插件形式提供，来自仓库自身的插件市场。在 Claude Code 中：

```text
/plugin marketplace add getopenscreen/openscreen
/plugin install openscreen@openscreen
```

插件自带 OpenScreen 的 MCP 服务器：一个小型 Node 脚本会找到已安装的应用，并用 `mcp` 启动它，因此执行 `/reload-plugins` 后或在新会话中，工具就已可用，无需 `claude mcp add`。如果找不到可用的应用，它只提供一个工具 `openscreenSetup`，说明它检查了什么，以及如何安装和设置 OpenScreen。

对于共享插件的 Codex 和 ChatGPT 桌面应用：

```bash
codex plugin marketplace add getopenscreen/openscreen
codex plugin add openscreen@openscreen
```

之后，OpenScreen 会连同其技能一起出现在应用的已安装插件中。在这里，MCP 服务器用上面的 `codex mcp add` 命令添加。

## AI 代理能做什么 {#what-the-agent-can-do}

用日常语言描述你想要的编辑，例如“剪掉开头的空白”“我打开终端时放大画面”。AI 代理通过真实的时间轴操作来完成编辑，而不是重新渲染：它可以添加和调整删减区间、缩放、速度区间、标注（文字、箭头，以及遮住屏幕上隐私信息的模糊）、导入的音轨及其淡入淡出和全屏摄像头区间，在你的点击处添加自动缩放，编辑片段的入点/出点和裁剪，放入另一个素材的画面，复制、重新排序或移除片段，还会读取转录文本，找到你所指的内容。它还能设置视频的外观：背景、边距、圆角、阴影、设备边框、画面比例、摄像头布局、光标和总音量。它还能写出设置里没有的视觉效果：参见[自定义效果](./effects.md)。

有两件事尤其值得交给它：

- **剪掉静音和口头语。** AI 代理读取转录文本，把这些片段作为删减区间剪掉，你可以像对待自己添加的区间一样拖动或删除它们。手动操作时，你需要在[转录文本](./captions.md#transcript-editing)中逐个剪掉。
- **翻译字幕。** 编辑器中没有翻译按钮。AI 代理读取字幕短语，用它自己的模型翻译，并把结果作为一个语言层保存在转录文本旁边：参见[翻译](./captions.md#translation)。它还可以开启[字幕](./captions.md)，设置字幕的样式和位置。

`transcribe` 像编辑器打开项目时那样，在本机用 Whisper 处理项目的媒体。

AI 代理可以列出所有项目，并读取或编辑其中任何一个。OpenScreen 打开时，除非 AI 代理指定其他项目，这些工具作用于编辑器中打开的项目。它还可以创建项目（空项目，或基于一个视频文件），重命名项目，以及向项目的媒体添加或从中移除视频、音频或图片文件。图片会作为显示该图片的几秒无声片段添加。删除项目不在这些工具之列：这仍由你在应用中完成。

## 实时编辑与撤销 {#live-edits-and-undo}

每项编辑都会在生效时立即保存：

- **对编辑器中打开的项目**，只要 OpenScreen 在运行，AI 代理就通过应用进行编辑。编辑会立即显示在编辑器中，每项编辑都是一步 `Ctrl/Cmd + Z`，与你自己的编辑一样。AI 代理会被要求在进行一系列编辑之前保存一个检查点，因此你可以让它们一步把项目恢复原样，而这一步本身也可以用 `Ctrl/Cmd + Z` 撤销。如果应用没有响应，对该项目的编辑会被拒绝，因为编辑器会用自己的副本覆盖这些编辑。
- **对其他任何项目**，编辑会保存到它的文件中，`Ctrl/Cmd + Z` 无法撤销。AI 代理必须在第一次编辑之前保存该项目的检查点，恢复到这个检查点是唯一的撤销方式。

检查点保存在内存中。OpenScreen 运行时，检查点会一直保留到它退出；否则会保留到 AI 代理的会话结束。只保留最近的 20 个检查点，因此较早的检查点可能会更早失效。

## 让 AI 代理制作整段视频 {#letting-an-agent-make-the-whole-video}

AI 代理可以从录制到导出独立完成一整段视频。除编辑工具外，`openscreen mcp` 还让 AI 代理能使用 `listSources`、`startRecording`、`stopRecording`、`setPointerTrack`、`exportVideo`、`exportAudio`、`exportCaptions`、`getFrames`、`getContactSheet`、`getBeforeAfter`、`getAudioReport` 和 `createProject`。与录制栏一样，录制时也可以录下你的摄像头和系统自带的光标；导出则接受导出对话框的选项：MP4 的画质和帧率，GIF 的帧率、尺寸和循环。`exportAudio` 将项目的音频，或单独一条导入的音轨（用 `importMedia` 和 `addAudio` 添加的旁白），写入 WAV 或 M4A，与 MP4 的混音完全一致。`exportCaptions` 将字幕写入 SRT 或 WebVTT 字幕文件，时间与导出的视频对齐。

AI 代理还能检查自己的成果。`getFrames` 显示视频中选定的时刻，或从 `startSec` 到 `endSec` 的一段；加上 `region` 时，只返回画面的这一部分，并保持视频本身的分辨率，以便看清小字。`getContactSheet` 把许多时刻排在一张图上，每个都标有时间：可以看整段视频的节奏，也可以逐帧看一次缩放。`getBeforeAfter` 把一系列编辑前后的同一时刻并排显示，并指出画面在哪里发生了变化。`getAudioReport` 测量项目声音的响度、真峰值和静音段。在编辑工具中，`listStylePresets` 和 `applyStylePreset` 通过一次编辑，让项目采用某个**预设**的外观。

- **每次录制都会成为一个新项目**，出现在你的项目列表中，并且与在应用中录制的内容一样，在录制下来的点击处添加缩放：时间和位置都相近的点击共用一个缩放，开头几秒和结尾保持全屏。AI 代理的每项编辑都会保存到项目文件中，撤销它们要靠 AI 代理创建的检查点：参见[实时编辑与撤销](#live-edits-and-undo)。
- **在 AI 代理请求之前，录制内容没有转录文本。** AI 代理会在删除词语或开启字幕之前调用 `transcribe`。Whisper 在你的电脑上运行，OpenScreen 打开时则在 OpenScreen 中运行。
- **由脚本驱动的录制**（例如 Playwright）永远不会移动屏幕指针。AI 代理通过 `setPointerTrack` 把它自己的操作日志交给 OpenScreen，视频照样会有光标及其缩放。
- **这些技能**教 AI 代理如何完成工作。`openscreen-demo` 带它从分镜脚本做到成品视频，之后把视频附加到拉取请求中，让审阅者直接在那里看到改动；或者起草一条 X 帖子，而且只有在你同意之后才会发布。另外六个技能各自深入一个步骤：`openscreen-capture`（干净、可重复的录制，包括不打开任何窗口录制的网页）、`openscreen-motion`（缩放、标注和节奏）、`openscreen-effects`（自定义效果）、`openscreen-sound`（旁白、音乐和响度）、`openscreen-review`（视频发出前的检查）和 `openscreen-deliver`（格式、大小以及交付视频）。使用 `npx skills add getopenscreen/openscreen` 一次全部添加。它们位于 [`plugin/skills/`](https://github.com/getopenscreen/openscreen/tree/main/plugin/skills)。
