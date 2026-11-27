---
id: captions
title: Captions & transcript
sidebar_position: 7
description: "Transcribe on-device with Whisper in 100 languages, burn in styled captions, have your own agent translate them, and cut a recording by deleting words."
keywords:
  - automatic captions
  - subtitles
  - Whisper transcription
  - offline transcription
  - caption translation
  - transcript editing
---

# Captions & transcript

OpenScreen transcribes your recording's audio **entirely on-device** — your audio is never uploaded, and once the model is on disk it works offline. That one transcript is then the source for two things: the captions burned into your video, and a text view you can edit your recording from.

## Transcribing

Every clip carries its own transcript. Run it either way:

- From the **Media** stage — select an asset card and hit **Regenerate**. This is also where you force one of Whisper's 100 languages under **Regenerate as** instead of leaving it on **Auto** detection, and where per-asset status lives (Pending transcription, Transcribing, Transcript ready, Transcription failed, and the others listed in [Media library](./media-library.md#media-mode)).
- From the **Transcript** facet in the editor's inspector — **Transcribe now** runs the same pipeline on the current media.

The whisper.cpp engine ships inside the app; the model does not. The first run downloads it from huggingface.co (~264 MB, SHA-256 verified, written atomically so a half-download can never be picked up) — the one moment transcription needs a network. After that it is fully offline, on a backend picked at runtime: Metal on Apple Silicon, Vulkan on Windows and Linux with a CPU fallback, and CPU on Intel Macs.

Word timings come from Whisper's own DTW token timestamps, then get re-anchored on the audio itself — every boundary is pulled back to the quietest moment just before it. This is what makes a transcript-driven cut land where the word actually starts instead of a syllable late.

## Captions

Captions are a **live view of the transcript**, not generated text you then maintain. Change the transcript, change the caption settings, or move clips on the timeline, and the cues follow on the next frame — there's no regeneration step and no stale copy to reconcile.

In the **Transcript** facet of the inspector, click **Captions**:

| Section | Controls |
|---|---|
| **Show captions** | Master on/off for both preview and export. |
| **Language** | *Original (transcript)*, or any translation layer the project has. |
| **Text** | Font, size, bold, text color. |
| **Background** | **None**, **Dark**, or **Light** plate behind the text, and its opacity. |
| **Position** | **Bottom** or **Top**, with the distance from that edge (0–50% of the frame); **Left**, **Center**, or **Right**, with the distance from that side (0–25%, none for Center). |
| **Line length** | Min and max words per line (1–12). Lines are packed inside that range. |

Everything in **Position** is measured against the **exported frame**, not against the video inside it. Captions stay where you put them when you change padding, and they can sit in the padded area — set the vertical distance to 0 and the text lands flush against the top or bottom edge of the frame. Long captions grow away from the edge they are pinned to, so a bottom caption grows upward and a top caption grows downward.

Size is expressed in pixels at a 1080-high frame and scales with the real output, so captions look the same at 720p, 1080p, or source. Preview and export share the same layout code — what you see is what gets burned in. Burned in is the only form they take in the editor and the CLI: neither writes a sidecar `.srt` or `.vtt`, so captions can't be turned off by whoever watches the file. An agent can write one with the `exportCaptions` tool, timed on the exported video ([AI editing](./ai-editing.md#letting-an-agent-make-the-whole-video)). [Local captions compared](/features/captions/) names recorders that do write a caption file.

### Translation

The editor has no translate button: captions are translated by your own agent, through OpenScreen's MCP server (see [AI editing](./ai-editing.md)). Ask it for the language you want, "add a French version of the captions": it reads the caption phrases, translates them with its own model, and stores the result in the project as a translation layer. The text it reads goes to that agent's provider, under your account with it. OpenScreen itself sends nothing.

A translation is stored **beside** the transcript, never in it: the original text and its timings stay untouched. The Captions pane lists the layers a project has: pick one under **Display**, switch back to *Original* at any time, or delete a translation, which leaves the recording exactly as it was. After you add footage, the agent only has the new phrases to translate, and a phrase with no translation shows its original words rather than invented ones.

:::note
Projects made with the older "generate captions" flow carry caption text as real annotations, which would draw on top of the live layer. The Captions pane detects them and offers to remove them — it asks first, since it deletes data.
:::

## Transcript editing

The **Transcript** facet shows the aggregated transcript across every clip on the timeline. It's a live text view of your recording:

- Select a word or a range of words and press `Backspace`/`Delete` to mark that span as skipped — it's cut from playback and export, exactly like a trim region on the timeline, just driven from the text instead.
- Skipped spans show struck through in red. Hover one to restore it.
- Silences are marked inline and can be trimmed or restored the same way.

No upload, no cloud — this runs on the transcript already sitting in your project.
