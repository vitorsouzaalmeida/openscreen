---
id: ai-editing
title: AI editing
sidebar_position: 8
description: "Edit OpenScreen projects with your own agent: Claude Code, Codex or any MCP client starts `openscreen mcp` and records, edits, transcribes and exports. No provider and no key in the app."
keywords:
  - AI video editing
  - MCP video editor
  - Claude Code video editing
  - Codex video editing
  - privacy
---

# AI editing

OpenScreen has no model of its own, and none to connect in the app. AI editing is done by an agent you already use, such as Claude Code or Codex: it starts `openscreen mcp`, OpenScreen's MCP server, and works through its tools. The agent signs in with its own account, and OpenScreen never sees it. OpenScreen itself sends nothing to any model: what the agent reads through the tools, such as the project, the transcript and still frames, goes to that agent's provider, under your account with it. The app's own network use (the transcription model downloads, update checks) is listed in the [FAQ](./faq.md#does-openscreen-work-offline).

:::tip
None of this is required. Recording, editing, transcription, captions, and export all work with no account and no agent. Of those, only transcription needs a download, once: its [models](./captions.md#transcribing), on your first run.
:::

:::note
Earlier versions had a chat panel in the editor, connected to a model provider with your own API key, and an MCP server to turn on in the app's settings. Both were removed, along with the two features that ran on that key: the **Translate** button in the Captions pane and **Smart cuts** in the timeline's **Auto-enhance** menu. Your own agent now does those jobs through the tools described here.
:::

## Setting it up

There is nothing to turn on in the app: no port, no token, no setting. The agent starts the app's own executable with `mcp` and talks to it over stdin and stdout, with your rights, as it would run `openscreen record`. So it can record your screen, edit and export with nothing to allow in the app. The quickest way is to paste this into your AI agent (Claude Code, Codex, Cursor…):

```text
Install the OpenScreen skills with `npx skills add getopenscreen/openscreen -y`, then follow openscreen-demo to make a demo video of this feature.
```

The skills install OpenScreen if it is missing, once you agree. Installed this way, without the plugin below, the `openscreen-demo` skill adds OpenScreen's MCP server, then asks you to open a new session and say *continue the OpenScreen demo*: an agent only gets new tools in a new session. To set it up by hand instead:

```bash
claude mcp add openscreen -- "<executable>" mcp
codex mcp add openscreen -- "<executable>" mcp
```

`<executable>` is the app's executable, listed for each system in [Running the CLI](./cli.md#running-the-cli). Other clients, Cursor for one, take a stdio server with the executable as `command` and `["mcp"]` as `args`.

The skills also come as a plugin, from the repository's own marketplace. In Claude Code:

```text
/plugin marketplace add getopenscreen/openscreen
/plugin install openscreen@openscreen
```

The plugin brings OpenScreen's MCP server with it: a small Node script finds the installed app and starts it with `mcp`, so the tools are there after `/reload-plugins` or in a new session, with no `claude mcp add`. When it finds no usable app, it serves one tool, `openscreenSetup`, that says what it checked and how to set OpenScreen up.

For Codex and the ChatGPT desktop app, which share their plugins:

```bash
codex plugin marketplace add getopenscreen/openscreen
codex plugin add openscreen@openscreen
```

OpenScreen then shows among the app's installed plugins, with its skills. There, the MCP server is added with the `codex mcp add` command above.

## What the agent can do

Describe the edit in plain language — "cut the dead air in the intro", "zoom in when I open the terminal". The agent works through real timeline operations, not a re-render: it can add and adjust trims, zooms, speed regions, annotations (text, arrows, and blurs that hide private details on screen), imported audio tracks with their fades, and Full Camera segments, add automatic zooms on your clicks, edit a clip's in/out points and crop, place another source's footage, duplicate, reorder or remove clips, and read the transcript to find what you're referring to. It also sets the look of the video: background, padding, rounded corners, shadow, device frame, format, the camera layout, the cursor and the master volume. And it can write a visual effect the settings don't offer: see [Custom effects](./effects.md).

Two things to ask it for in particular:

- **Cutting silences and filler words.** The agent reads the transcript and cuts those spans as trims, which you can drag or delete like your own. By hand, you cut them one at a time in the [transcript](./captions.md#transcript-editing).
- **Translating the captions.** The editor has no translate button. The agent reads the caption phrases, translates them with its own model, and stores the result as a language layer beside the transcript: see [Translation](./captions.md#translation). It can also turn the [captions](./captions.md) on, style and place them.

`transcribe` runs the on-device Whisper on a project's media, as the editor does when it opens a project.

The agent can list every project and read or edit any of them. While OpenScreen is open, the tools act on the project open in the editor unless the agent names another one. It can also create a project, empty or from a video file, rename one, and add a video, audio or image file to a project's media or remove one. An image is added as a silent clip of it, a few seconds long. Deleting a project is not among the tools: that stays yours to do in the app.

## Live edits and undo

Each edit is saved as it lands:

- **On the project open in the editor**, while OpenScreen is running, the agent works through the app. An edit appears in the editor at once, and each one is a single `Ctrl/Cmd + Z` step, like an edit of your own. Agents are told to save a checkpoint before a series of edits, so you can ask them to put the project back as it was in a single step, which `Ctrl/Cmd + Z` can itself undo. If the app does not answer, edits to that project are refused, since the editor would save its own copy over them.
- **On any other project**, an edit is saved to its file, where `Ctrl/Cmd + Z` cannot reach it. The agent must save a checkpoint of that project before its first edit, and putting the project back from it is the only undo.

Checkpoints are kept in memory. While OpenScreen is running they last until it quits; otherwise they last until the agent's session ends. Only the 20 most recent checkpoints are kept, so an older one can be gone sooner.

## Letting an agent make the whole video

An agent can make a whole video on its own, from the recording to the export. Besides the editing tools, `openscreen mcp` gives it `listSources`, `startRecording`, `stopRecording`, `setPointerTrack`, `exportVideo`, `exportAudio`, `exportCaptions`, `getFrames`, `getContactSheet`, `getBeforeAfter`, `getAudioReport` and `createProject`. A take can also record your webcam and the system's own cursor, as the recording bar can, and an export takes the Export dialog's options: quality and frame rate for an MP4; frame rate, size and looping for a GIF. `exportAudio` writes the project's audio, or one imported track alone (a voiceover added with `importMedia` and `addAudio`), to a WAV or an M4A, exactly as the MP4 mixes it. `exportCaptions` writes the captions to an SRT or a WebVTT subtitle file, timed on the exported video.

The agent also checks its own work. `getFrames` shows chosen moments of a video, or a span from `startSec` to `endSec`, and with a `region` only that part of the picture, at the video's own resolution, to read small text. `getContactSheet` lays many moments on one image, each with its time: the rhythm of the whole film, or a zoom frame by frame. `getBeforeAfter` shows the same moments before and after a series of edits, side by side, and says where the picture changed. `getAudioReport` measures the loudness, true peak and silences of a project's sound. Among the editing tools, `listStylePresets` and `applyStylePreset` give a project the look of one of the **Presets** in one edit.

- **Each take becomes a new project** in your project list, zoomed on its clicks as a recording made in the app is: clicks close in time and on screen share one zoom, and the first seconds and the end stay on the whole screen. Every edit the agent makes is saved to the project's file, and its undo is the checkpoint the agent takes: see [Live edits and undo](#live-edits-and-undo).
- **A take has no transcript until the agent asks for one.** It calls `transcribe` before it cuts words or turns the captions on. Whisper runs on your machine, in OpenScreen when it is open.
- **A take driven by a script** (Playwright, for example) never moves the screen pointer. The agent hands OpenScreen its own log of the actions with `setPointerTrack`, and the video gets a cursor and its zooms all the same.
- **The skills** teach an agent the job. `openscreen-demo` carries it from the storyboard to the finished video, then attaches the video to a pull request, so reviewers watch the change in place, or drafts a post on X that it publishes only once you say yes. Six more each go further into one step: `openscreen-capture` (a clean, repeatable take, including a web page recorded with no window), `openscreen-motion` (zooms, callouts and pacing), `openscreen-effects` (custom effects), `openscreen-sound` (narration, music and loudness), `openscreen-review` (the check before the video goes out) and `openscreen-deliver` (format, size, and handing the video over). Add them all with `npx skills add getopenscreen/openscreen`. They are in [`plugin/skills/`](https://github.com/getopenscreen/openscreen/tree/main/plugin/skills).
