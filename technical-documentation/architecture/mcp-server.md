# MCP server

`openscreen mcp` is how a model drives OpenScreen, and the only way: the app has no model of its own and no server to connect to. The user's own MCP client (Claude Code, Codex, Cursor, anything that speaks MCP) starts the app's executable with `mcp` and talks to it on stdin/stdout. The client brings its own model and its own sign-in; OpenScreen never sees, stores or relays those credentials.

The tools act on any of the user's projects, not only the one open in the editor. They read and edit a project, record a take, transcribe it and export it.

| | `openscreen mcp` |
|---|---|
| Process | One of its own, started by the client: the app's executable with `mcp` |
| Setup | `claude mcp add openscreen -- <executable> mcp` ([executables](../../docs/cli.md#running-the-cli)), or the plugin in [`plugin/`](../../plugin/README.md) |
| Auth | None: the client launched the process with the user's rights. No port, no token, no switch in the app |
| Edits, recording, export | Always allowed |
| Project open in the editor | While the app runs, the call is forwarded to it and the edit lands live in the editor, one undo step per call. With no app answering, refused ([the marker](#the-open-in-editor-marker)) |
| Other projects | Read from and saved to their file, a checkpoint first |
| Tools | `listProjects`, the document tools, `transcribe`, the project tools (`setProjectInfo`, `importMedia`, `removeMedia`), the checkpoint tools, and the media tools: `listSources`, `startRecording`, `stopRecording`, `setPointerTrack`, `exportVideo`, `exportAudio`, `exportCaptions`, `getAudioReport`, `getFrames`, `getContactSheet`, `getBeforeAfter`, `createProject` |
| A take | Recorded by a hidden runner of its own process, and made a project there |
| Checkpoints | In the app's memory while it runs, lost when the app quits; otherwise in this process's, lost when it exits, which it does when the client disconnects |

**When the app runs, it is the authority**: `openscreen mcp` forwards its document calls to it ([below](#openscreen-mcp-and-the-running-app)), so one process writes the projects. Only when no app answers do two processes write the same project folder; the [open-in-editor marker](#the-open-in-editor-marker) and the byte compare of `saveProjectIfUnchanged` are then what keep them from overwriting each other's work.

| File | Role |
|---|---|
| [`electron/ai-edition/document-tools.ts`](../../electron/ai-edition/document-tools.ts) | The document tools' surface: names and argument schemas (`TOOL_ARG_SCHEMAS`), descriptions (`TOOL_DESCRIPTIONS`), the editing guidance the server sends as its instructions, and `runDocumentTool`. |
| [`electron/ai-edition/agent-tools.ts`](../../electron/ai-edition/agent-tools.ts) | The executor (`executeAgentTool`): validates a call's arguments and applies it to a document. |
| [`electron/mcp/openscreen-mcp-server.ts`](../../electron/mcp/openscreen-mcp-server.ts) | The MCP server (`createOpenScreenMcpServer`), the tool runner (`createToolRunner`: routing, refusals, checkpoints), and the texts a client reads (`mcpInstructions`). |
| [`electron/mcp/stdio-server.ts`](../../electron/mcp/stdio-server.ts) | `openscreen mcp`: the server, the runner and the media tools on stdin/stdout. |
| [`electron/mcp/app-channel.ts`](../../electron/mcp/app-channel.ts) | The local channel `openscreen mcp` forwards its document calls through to the running app. See [`openscreen mcp` and the running app](#openscreen-mcp-and-the-running-app). |
| [`electron/mcp/project-tools.ts`](../../electron/mcp/project-tools.ts) | The project tools the runner runs: rename a project, import a file into its media, remove one. |
| [`electron/mcp/media-tools.ts`](../../electron/mcp/media-tools.ts) | The media tools (`createMediaTools`), their capability block for the instructions (`mediaPreamble`), and the recorder. |
| [`electron/mcp/editor-document-host.ts`](../../electron/mcp/editor-document-host.ts) | Main-process side of the live document: asks the editor window for a snapshot and hands edits back. |
| [`src/lib/ai-edition/store/mcpDocumentHost.ts`](../../src/lib/ai-edition/store/mcpDocumentHost.ts) | Renderer side: answers snapshot / apply requests from the project store, and transcribe requests through the editor's transcription queue. Mounted by `NewEditorShell`. |
| [`electron/ai-edition/caption-tools.ts`](../../electron/ai-edition/caption-tools.ts) | The caption and vocabulary tools, routed there by `executeAgentTool`. |

## One tool surface

The model never free-writes the project document. It calls a fixed set of tools, and each call goes through the same steps: `runDocumentTool` reads the cursor telemetry the zoom tools need (for `addAutoZooms`, the timeline wand's plan, `collectAutoZoomSuggestionsForDocument`, over every take on the timeline), then `executeAgentTool` validates the arguments and returns either a new schema-valid document or an error. The tools use the same [document model](document-model.md) and the same mutations as manual editing.

The server registers `TOOL_ARG_SCHEMAS` (names and zod schemas) and `TOOL_DESCRIPTIONS`, and builds its `instructions` around the editing guidance, all from [`document-tools.ts`](../../electron/ai-edition/document-tools.ts). A tool added to that table appears over MCP with no further work, and the MCP test asserts the listed tools equal `listProjects`, then `OPENSCREEN_TOOL_NAMES`, then the three project tools, then the two checkpoint tools, then the [media tools](#the-media-tools). What the server adds to the document tools:

- **`listProjects`**, a tool of its own: every project's id, title, `updatedAt`, asset count, and `open` for the one in an editor (this process's, or the app's seen through the marker).
- **`transcribe`**, registered where `McpToolDeps.transcribe` is wired (by `registerIpcHandlers`), see [Transcription](#transcription).
- **An optional `projectId` on every document tool and both checkpoint tools**, added to its schema with `.extend()` at registration and stripped again before the call reaches the executor, which never sees it. See [Which project a call acts on](#which-project-a-call-acts-on).
- **`createCheckpoint` / `restoreCheckpoint`**, see [Checkpoints](#checkpoints).
- **The project tools**, see [The project and its media](#the-project-and-its-media).
- MCP metadata: `readOnlyHint` for the reads (`!isMutatingTool`), `listProjects` and `createCheckpoint`, and `destructiveHint` for `replaceTimeline`, the three `remove*` document tools, `removeMedia` and `restoreCheckpoint`.

### The document tools

The tools that cut, order and decorate the timeline. The captions, the look and the effects have their own sections below; `TOOL_ARG_SCHEMAS` is the full list.

| Tool | What it does | What it mutates |
|---|---|---|
| `getCurrentDocument` | Reads a compact project, asset, clip, trim, and modifier snapshot with explicit time bases. Each asset reports `hasCameraTrack` / `cameraVisible` / `hasCursorTelemetry` beside `hasTranscript` (`hasCursorTelemetry` is three-valued: `true`, `false` when the asset was checked and has none, `null` when it was not checked — never `false` for something we failed to look at), the document reports `hasAnyCamera` and `autoFocusAll`, and each zoom reports the `renderedScale` the viewer will see plus `customScale` / `depthIsOverridden` when a custom scale makes its `depth` inert, and `hideCursor` when set. Each annotation reports its type and box in the terms the writes take (`box` frame or footage, centre `x`/`y`, `width`/`height`), plus a text's look, an arrow's `figureData` or a blur's `blurData`; each audio track its gain and fades. Each zoom also reports where its camera moves sit on the ruler, outside the pill: `zoomInFromSec`, `zoomOutUntilSec` (speed-aware, from `zoomTransitions` in `src/lib/ai-edition/timeline/zoom-transitions.ts`), `transitionSec`, `cutByTrim` (`in` / `out` / `both`) when a trim cuts a move, and `cutByJunction` when a clip junction does (the compositor renders each clip on its own, so a move running past its clip's edge is lost too), so the export jumps there (#1028). A side cut by both is blamed on the cut nearest the pill, where the jump is. Chained zooms (at most 1.5 s apart on screen, no trim or clip junction between them) report the pan instead: `panToZoomId` / `panUntilSec` on the first, `panFromZoomId` on the second, in place of its zoom-out and zoom-in (`chainedPans`). | Nothing. |
| `getTranscript` | Reads the transcript segments for an asset, or the primary asset, in full. On the production path a segment is one word, so a half-hour recording is a few thousand of them — there is no cap. | Nothing. |
| `getCursorTrack` | Reads the recorded pointer telemetry for an asset as REAL SAMPLES, reduced per axis against time (Douglas–Peucker) rather than summarised: every point returned is one that was recorded, carrying its source `atSec`, `cx`/`cy`, the `virtualSec` that `addZoom` takes (left off the points, with `virtualEqualsSource` on the envelope, when the two coincide everywhere), a `shape` index per distinct pointer bitmap, and `kind` / `trimmed` where they apply. `visible:false` marks a hidden pointer; absent means visible, including older sidecars. Visibility changes survive downsampling even when the pointer stays still. Answers `available:false` with `reason:"no-sidecar"` (checked, this asset has none) or `reason:"unavailable"` (could not be read from here), and the two are never conflated. | Nothing. |
| `addTrim` | Adds one source-time cut inside a clip. Like the zoom writes and `setTrim`, it reports `cutTransitions` (zoom, side, seconds lost, `by` trim or junction) when the edit newly cuts a zoom's move in or out; a warning, never a refusal. | `timeline.trimRanges`. |
| `addTrims` | Adds many cuts in one call, replaying `addTrim` per entry so the rules cannot drift apart. Each range stands alone: one that cannot be placed is refused by itself and named with its index and reason while the rest are applied, and the result leads with `requested` / `appliedCount` / `refusedCount`. Only a batch where nothing landed is an error. | `timeline.trimRanges`. |
| `removeWords` | Cuts spoken words chosen by their `getTranscriptWords` IDs (fillers, a flubbed phrase, a duplicate take), qualified by `assetId` since IDs restart per asset. Every ID is resolved to one recorded asset, valid timestamps and exactly one covering clip before anything is written; a missing, invalid, duplicated, already-cut or ambiguous ID refuses the whole request. Words consecutive in the transcript go out as one `addTrim` span, so a phrase leaves no gaps playing. The result reports each word with the trim actually stored. The transcript is untouched. | `timeline.trimRanges`. |
| `setTrim` | Moves or resizes an existing source-time trim. | The matching `timeline.trimRanges` entry. |
| `setClipRange` | Changes a clip's source in/out points, bounded by the asset's known length (a still's hold included), and relays clips back-to-back, its crop, and its rotation (`0` or `180`, the Edit clip dialog's choices). A rotation goes through `setClipRotation`, the mutator the dialog's Apply uses, so the clip's zoom focus and footage-space blurs follow the turned picture. | The clip range, crop and rotation, and any anchored regions clamped, removed or turned by the shared timeline mutators. |
| `moveClip` | Reorders a placed clip by naming the clip it should play before (`null` = last). Preserves every clip id, source range, trim and anchored modifier. | Timeline clip order; anchored modifiers' derived ms follow their clip. |
| `replaceTimeline` | Rebuilds the primary-asset timeline from kept source-time intervals. Preserves the id, origin and label of every clip an interval reproduces exactly, carries existing trims through, and never touches another asset's trims. Refused when it would merge away, shorten or drop a clip, or when the intervals are not ascending (a reorder it cannot perform — the refusal points at `moveClip`). | Timeline clips and trim ranges. |
| `addZoom` | Adds a clip-anchored zoom over virtual timeline time. `depth` is an ordinal selecting from `ZOOM_DEPTH_SCALES` (1.25×–5.0×, non-linear); the result reports the resulting `renderedScale`. It also takes the inspector's `focusMode`, `hideCursor` and `customScale`, under the same rules as `setZoom`. When the pointer track can be read for the footage under the span it also reports `cursorAnchor`: the `focus` the call used (default included) beside the median recorded pointer position over the span the zoom LANDED on, with `spread`, `offset` and the sample count. The source windows come from the stored fragments' own `sourceStartSec`/`sourceEndSec`, so a clamped or split zoom is described by the windows it really occupies; trimmed instants are left out; and the field is OMITTED — never guessed, never turned into an absence of data — when no track covers that footage. | `zoomRanges`. |
| `addZooms` | Adds many zooms in one call, replaying `addZoom` per entry, with the same per-entry refusal and reporting contract as `addTrims`. Each applied entry carries its own `cursorAnchor`. | `zoomRanges`. |
| `setZoom` | Moves, resizes, or restyles a zoom pill: level, focus, `focusMode`, `hideCursor`, 3D camera. Changing `depth` clears any `customScale` on that pill — otherwise the write is a no-op at render — and says so in the result. A `customScale` is written as the inspector writes a typed level (`zoomLevelFor`: to the hundredth, a table level as its depth) and refused past the clip's `zoomScaleLimit`; `depth` with `customScale` is refused. Reports `cursorAnchor` against the zoom's EFFECTIVE focus, read back off the document, so a span-only edit still learns what its unchanged focus now looks at. | The clip-anchored `zoomRanges` fragments represented by that pill. |
| `addSpeed` | Adds a clip-anchored speed region over virtual timeline time. | `legacyEditor.speedRegions`. |
| `setSpeed` | Moves, resizes, or changes an existing speed pill. | The corresponding `legacyEditor.speedRegions` fragments. |
| `addAnnotation` | Adds a text, arrow (`figure`) or privacy `blur` annotation over virtual timeline time. An arrow or a blur is the editor's text switched through `convertAnnotationKind`, then given its box and its `figureData` / `blurData` (validated by `figureDataSchema` / `blurDataSchema`). A text's `fontFamily` is one of `TEXT_FONT_FAMILIES`, the faces the compositor ships and draws, and its box is measured in that face. Images are left out: they need a file. A freehand blur is refused, as the inspector no longer offers it. | `annotations`. |
| `setAnnotation` | Moves, resizes, retypes or restyles an annotation. A type change goes through `convertAnnotationKind` with the footage under each fragment (`annotationFootageRect`), as the inspector's type switch does; `figureData` / `blurData` merge only the keys sent. Arguments of another kind (width on a text, blurData on an arrow) are refused. | The corresponding clip-anchored `annotations` fragments. |
| `addLayoutChange` | Changes the layout from a RAW document-timeline time until the next change. Camera presets require linked camera footage. | The shared `layoutRegions` partition, or the global preset when uniform. |
| `setLayoutPreset` | Changes one passage by an ID from `getCurrentDocument.layoutSegments`; equal neighbours merge. An unchanged preset is refused. | The same layout partition. |
| `moveLayoutBoundary` | Moves a passage's start in RAW seconds, updating both neighbours atomically. The first boundary is protected. | The same layout partition. |
| `addEffect` | Writes a shader effect (WGSL, [docs/shader-effects.md](../../docs/shader-effects.md)) and poses it over virtual timeline time, or poses one of the project's effects again by `effectId`. The compositor checks the code first (`checkShaderEffect`); code that does not compile is refused with the error at the agent's line. The result gives the cost tier and, when the tier runs long, a recommendation, never a refusal. One effect runs at a time: two cannot overlap. | `shaderEffects` (a new definition) and `shaderEffectRanges`. |
| `setEffect` | Moves, re-tunes (`values`), animates (`animate`: keyframes per parameter, each list replaced whole) or retargets an effect pill. | The pill's `shaderEffectRanges` fragments. |
| `setEffectDefinition` | Changes an effect's name, description, code or parameters, and so every region using it; new code is checked first. A removed parameter's values and keyframes drop, as do a re-typed one's keyframes. | The `shaderEffects` entry and its regions' `values` and `animate`. |
| `getEffect` | Reads one effect in full, code included; `getCurrentDocument` lists effects without their code. | Read only. |
| `listStylePresets` | Lists the Style presets menu: the built-in look first, then the saved presets read through `ToolRuntime.stylePresets`, each with its look and `active`. | Nothing. |
| `applyStylePreset` | Applies a preset as the menu does, `stylePresetPatch` through `applySettingsPatch`: the look, never the content. | `legacyEditor` look settings. |
| `removeTrim` | Deletes a trim so its source span plays and exports again. | `timeline.trimRanges`. |
| `removeModifier` | Resolves and deletes a zoom, speed, annotation, layout change, audio, or effect by ID; `removedIds` lists the identifiers of the removed items. Audio IDs identify whole tracks (track groups), even when a track contains multiple stored fragments. Removing a layout change extends the preceding passage; the first passage is protected. | The matching modifier collection. |
| `removeClip` | Deletes a placed clip, closes the gap, and drops effects anchored only to it. The result names the modifiers and trims it took with it. | Timeline clips and affected anchored modifiers. |

Clips and trims use source time. Zoom, speed, annotation and effect tools use virtual edited-timeline time; the executor converts these spans to the clip-anchored millisecond representation used by the document.

Layout point tools use RAW document-timeline seconds. `getCurrentDocument.layoutSegments`
exposes their logical IDs, bounds and presets. The document stores clip/source anchors;
`buildSceneDescription` projects them into source time for native preview and export.
Legacy Full Camera executors remain compatibility aliases over this partition and are
not advertised to MCP clients. Migration-only camera envelopes are derived
from layout metadata rather than maintained as a second mutable collection.

The presets are picture-in-picture, dual-frame, vertical-stack, camera-only and
no-webcam; the camera presets require linked camera footage. A temporary passage needs a
change at its start and another at its end. `setEditorSettings.webcamLayoutPreset`
applies to the whole video; the passage tools are for a local edit. The MCP server tests
run a real client/server add/move/set/read/remove cycle, compare the document and the
native scene with the UI's shared mutations, and verify the preset enum and the mutation
annotations.

### Captions and their translation

The caption tools are document tools like the others: `getCaptions`, `setCaptionSettings`, `getCaptionTranslationUnits`, `putCaptionTranslation`, `removeCaptionTranslation`, `setVocabulary`. OpenScreen has no model to translate with. The client reads the phrases with `getCaptionTranslationUnits`, translates them with its own model and stores them with `putCaptionTranslation`; `setCaptionSettings` then shows that language. The transcript is never rewritten. See [transcription-and-captions.md](transcription-and-captions.md#translation).

### The effect contract

The server's one resource, `openscreen://effects/contract` ([`effects-contract.ts`](../../electron/mcp/effects-contract.ts)), holds the full WGSL contract of `addEffect`: the inputs an effect reads, its parameters, the rules, the cost tiers and two examples. It is too long for a tool description and versioned with the contract; the instructions point to it. `effects-contract.test.ts` checks that it names every field of the compositor's prelude, and `shader_fx::tests::the_examples_of_the_mcp_contract_compile` compiles its examples. The code an agent writes is checked by `McpToolDeps.checkShaderEffect`, the compositor's `checkShaderEffect`, wired in `registerIpcHandlers` like `cameraSegmentation`.

### The project's look

`setEditorSettings` ([`editor-settings-tool.ts`](../../electron/ai-edition/editor-settings-tool.ts)) writes every setting of the editor's look panes: background, frame, format, camera layout, cursor, `autoFocusAll` and `audioGainDb`. It takes a partial `EditorSettingsPatch` and applies it with `applySettingsPatch`, the editor's own write, plus what the panes do around a pick (a first fixed format fills the frame, an untouched camera roundness follows its shape, the camera framing is stored as size and pan). `setAspectRatio` is the same write for the format alone.

- **Validation.** Numbers are held to `SETTING_BOUNDS`, enums to the constant lists, and both wallpapers go through `parseStylePresetWallpaper`: a colour, a gradient, a bundled path or an inline PNG/JPEG, never `file://` nor a URL. The schema is strict, so a misnamed key is refused rather than dropped.
- **Read side.** `getCurrentDocument` adds `settings`, in the tool's own shape with data-URL wallpapers elided, and `settingsContext`: the formats on offer (`originalAspectRatios` from `collectNativeFormats`), `formatFill`, `hasTiltedZoom`, the bundled wallpapers, the cursor themes, `cameraSegmentation`, and `inactive`, each setting the editor hides in the current state with why. A write reports the same for the keys it set. The captions stay out of `settings`: `getCaptions` reads them and `setCaptionSettings` writes them, so no caption field has two owners.
- **Segmentation.** `McpToolDeps.cameraSegmentation` asks the compositor (`probeSegmentation`), wired in `registerIpcHandlers`; `openscreen mcp` inherits it with `mcpToolDeps`. Where nothing is wired it reads `null`, "not checked".
- **Style presets.** `listStylePresets` lists the editor's Style presets menu, built-in look first, each with its `look` and whether it is the project's look now (`sameStylePresetLook`, first match, as the menu lights one row). `applyStylePreset` applies one as the menu does, `stylePresetPatch` through `applySettingsPatch`: the look in one edit, never the content. The saved presets are read through `McpToolDeps.stylePresets` (`StylePresetService.list`, wired in `registerIpcHandlers`, inherited by `openscreen mcp`); where nothing is wired only the built-in one is offered, with a `warning`.

## What the client is told

Two processes build the server: `openscreen mcp`, which the client is connected to, and the app, which answers on its channel the calls forwarded to it. Every text a client reads must be true where it is produced, so the texts are composed rather than shared verbatim. `McpToolDeps.transport` selects them: `"stdio"` is the `openscreen mcp` process, `"app"` is the app answering on its channel.

- **Instructions** (`mcpInstructions`), read from the `openscreen mcp` process: the media tools' capability block (`mediaPreamble`), then the projects-and-checkpoints rules, then how long checkpoints live, then the editing guidance from `document-tools.ts`. The media block says the takes land in the app's project list, and the rules say that calls go through the app while it runs (the open project live, with `Ctrl/Cmd+Z`), and to the files when it does not. The app's channel registers none of the media tools, only a `setPointerTrack` of its own ([below](#the-media-tools)), so its instructions have no media block: no agent reads them.
- **A newer OpenScreen** (`update-notice.ts`), only on an install that updates itself (a Store, Flathub, Snap or Nix copy is kept current by its package manager). A user who reaches OpenScreen only through an agent never sees the app's update button, so `openscreen mcp` looks the latest release up on GitHub in the background and caches the answer in `mcp-update-check.json`. A successful lookup holds the next one off for six hours; a failed one (offline, rate-limited) writes nothing, so the next session tries again. When the cache names a newer version, a line opens the instructions: tell the user once that the app shows an update button for it once they open it, and never update OpenScreen yourself. The process itself updates nothing: its stdout is the protocol, its lifetime is the client's, and the NSIS installer would end it. The lookup never holds the handshake back, so the session that finds a release says nothing and the next one does.
- **Tool descriptions**, also read from the `openscreen mcp` process: `projectId` is "omit it only for the open project, while the app runs". `startRecording` and `stopRecording` say how a take is made ([below](#the-media-tools)). The paths of `exportVideo`, `exportAudio`, `exportCaptions` and `getFrames` may be absolute or relative to the server's working directory, which is the one the client started it in.
- **Messages**: no project to fall back on, a checkpoint required, an unknown checkpoint. A forwarded call is answered by the app in the app's terms: no project is open in the editor, or this project is not open in the editor and needs a checkpoint. A call that ran in the `openscreen mcp` process is only met with no app answering, and says so.

There is no edit switch. The client started the process itself, with the user's rights, and there is no other caller to keep out, so every tool may edit, record and export. The same holds for the calls it forwards to the app.

## Which project a call acts on

| `projectId` | While the app runs | With no app answering |
|---|---|---|
| omitted | Forwarded: the project open in the editor, through the editor. With none open the call fails and points at `listProjects`. | Fails, asking for a `projectId`. |
| the id of the project open in the app's editor | Forwarded: through the editor, never its file. The file is read first all the same (see below). | Refused ([the marker](#the-open-in-editor-marker)). |
| any other id | That project's file, through the app's one `DocumentService` (`getProjectForUpdate` → tool → `saveProjectIfUnchanged`). A write needs a checkpoint of that project first. | The same, in the `openscreen mcp` process. Refused while another process's editor holds the project. |

The open project is never written to disk from here because the editor holds it in memory and saves it as a whole: a file edit under it would be overwritten by the editor's next save, and the editor would never show it.

## Where the document comes from

### The open project

A forwarded call that acts on the project open in the editor reads the **live** document from the editor window, which owns it (`useProjectStore`, with its `revision`):

1. `EditorDocumentHost.snapshot()` sends `{op: "snapshot"}` on `ai-edition.mcp-request` to the editor; it answers `{document, revision}` (or `null` with no project open).
2. `runDocumentTool` runs against that document.
3. If the tool changed it, `apply(document, revision)` sends it back; the editor applies it through `applyAgentDocumentIfCurrent`, a revision-guarded apply, so it is saved and becomes **one undo step**.

A user edit that lands between 1 and 3 moves the revision and the apply is refused as a conflict; the client is told to re-read. The renderer also compares the project id, because the revision counter restarts at 0 when a project closes and a quick switch to another project could otherwise match. Calls are serialised in the main process so two of them never interleave.

Only the webContents that registered on `ai-edition.mcp-host` is asked, and only its replies count. An editor that unmounts or is destroyed stops being asked. A request unanswered for 30 s resolves to "no project" (reads) or `timeout` (writes, reported as "did not confirm", not as a failure, since the save may have landed).

`openscreen mcp` builds the same `EditorDocumentHost`, but no editor window ever exists in that process, so its snapshot is always `null`: it reaches the app's editor by forwarding the call to the app.

### Any other project

Read with `DocumentService.getProjectForUpdate` (`getProject`, migrated and relinked like any open, plus a version) and, if the tool changed it, saved with `saveProjectIfUnchanged` — the same instance every other save in the process goes through. Reads and saves of one project share its queue, so a read returns only once every read and save asked for before it is done.

A call naming a project reads its file **before** asking the editor for a snapshot. An editor open of that project already under way has then returned, and the editor installs what it read before it answers, so the snapshot shows the project and the call goes through the editor.

Before the save, the runner refuses, in this order and with nothing written:

1. **Another process's editor holds the project** ([the marker](#the-open-in-editor-marker)). That editor would save over the edit.
2. **The project has no checkpoint** in this runner's memory. An edit to a file is on no undo stack, so the checkpoint is its only way back ([Checkpoints](#checkpoints)).
3. **The project changed since the call read it.** There is no revision to guard a file with, so the save is refused with "NOT applied … re-read, then retry" when, since the read:
   - **anything read the project.** This is the editor opening it: from that read on it holds a copy without the MCP edit, and its next save would drop the edit without a word. A snapshot cannot see this in time, since the editor installs what it read only after the read returns. `DocumentService` counts every read and save of a project instead. The client's retry, with the same `projectId`, then goes through the editor. The open-file dialog never saves back a project's own file: it loads that project by id (`storedProjectId`), a read like any other.
   - **anything saved it, or its file changed.** The file must still be, byte for byte, the one the tool ran against. This also covers the other process, a writer outside the app (a sync tool, a restored copy) and a delete.

The check runs inside the project's queue, so nothing in the process reads or saves the project between the check and the write.

### The open-in-editor marker

When no app answers its channel, `openscreen mcp` cannot ask the app's editor anything, so the app says which project its editor holds: the editor sends the project id on `AI_EDITION_OPEN_PROJECT_CHANNEL`, and `DocumentService.markOpenInEditor` writes `.open-in-editor.json` (`{pid, projectId}`, temp file then rename) in the projects folder. Only the window that set it clears it, on closing the project or on being destroyed. `projectOpenInEditor()` reads it back and ignores a marker whose `pid` is no longer running, so an app that crashed blocks nothing. The runner checks it just before any write to a file; `listProjects` reports the project as `open`.

An edit refused this way is answered with `ProjectOpenInEditorError`'s message: the editor could not be reached, so retry, and if it is refused again, close the project in the app, or restart or update it. It takes an app that is alive but not answering, or one that predates forwarding.

## Checkpoints

A client chains several edits in one turn, and each is its own undo step, so reverting a turn by hand means one Ctrl+Z per call, interleaved with whatever the user did meanwhile. `createCheckpoint` saves the document in the runner's memory and returns a `checkpointId`; `restoreCheckpoint` hands that document back as the call's new document. On the project open in the app's editor it goes through the same revision-guarded apply, so the whole revert is **one undo step** the user can itself undo. The server instructions tell the client to checkpoint before a series of edits.

- They take `projectId` like every tool, so a project that is not open has them too: the checkpoint is read from its file, and the restore is saved to it with the same guards as any edit. That restore is not one undo step, since nothing holds the project's history.
- **A project that is not open cannot be edited without one.** Ctrl+Z cannot reach an edit to it, so a write there is refused until a checkpoint of that project is in memory, and the client is told to call `createCheckpoint` first. With no app answering, that is every project. `stopRecording` creates one for each new take and returns its id.
- **They cover the cursor sidecar.** `setPointerTrack` rewrites `<video>.cursor.json`. Before the runner writes a sidecar, it keeps the file's previous content (or its absence) in every checkpoint of that project that has none for it yet; a restore writes those back, and deletes a sidecar the take never had. A restore is itself such a write, so each checkpoint gets back its own state whatever order they are restored in.
- A restore is refused when the checkpoint belongs to another project than the one the call acts on. That message names the checkpoint's `projectId`: restoring a closed project's checkpoint takes it explicitly.
- It discards every edit since the checkpoint, the user's included. The tool description says so. A transcript an asset gained since the checkpoint is kept, where the checkpoint had none for it: it is the media read, not an edit (`keepTranscriptsMadeSince`).
- **Lifetime.** Checkpoints live in the runner's memory, the 20 most recent. In the app that is one runner (`createToolRunner`, built in `registerIpcHandlers`), shared by every `openscreen mcp` session it answers, and they are lost when the app quits. An `openscreen mcp` with no app answering keeps its own, lost when the process exits, which it does when the client disconnects. The unknown-checkpoint message says which.

## The project and its media

Three tools of the runner's own ([`project-tools.ts`](../../electron/mcp/project-tools.ts)) edit what the document tools cannot reach: the project's name and its media. They take `projectId` and go through the runner like any edit, so the project open in the editor changes there, live and one undo step, and any other project needs a checkpoint first. The app's channel serves them, so `openscreen mcp` forwards them to the running app like any document call.

- **`setProjectInfo`** sets `project.title`, trimmed and never empty, as the editor's name field commits it.
- **`importMedia`** files a video or audio file into `assets`, through the same `documentWithAsset` as `DocumentService.addAsset`: an audio file never claims the primary slot, a video claims it only when the project has none. Before the runner reads the project, the path is checked (absolute, a file, an extension `addAsset` accepts for the kind) and measured with the hidden-window probe (`openVideo`, hidden-video.ts), so the slow probe never holds a snapshot open. A probe that fails is not fatal, as in the editor: the asset has no `durationSec` and the editor measures it once it opens the project. In the app, `approveMedia` grants the file to the renderer, as picking it would, so the editor can play what a client imported into the project it has open. The kind defaults to the extension: audio for an audio-only one, video otherwise. The file lands in the media, not on the timeline: `addAudio` plays an audio file. An image (`.png`, `.jpg`, `.jpeg`, `.webp`) is filed as a silent video of it, `holdSec` long (5 s by default, 0.5 to 60): `makeStill` (`electron/media/stillClip.ts`) encodes it once with the bundled ffmpeg into the recordings folder's `stills` subfolder, and the asset is an ordinary `video` whose file ends `.still.mp4` (`isStillAsset`), so no schema change and no new render path. Transparent pixels become black, an image past 3840x2160 is scaled down, and a clip of it cannot outlast the hold. Without an ffmpeg the import is refused with the reason.
- **`removeMedia`** drops an asset with `documentWithoutAsset`, `DocumentService.removeAsset`'s own change, but refuses while a clip or an audio track still uses it, naming them: removing footage the timeline plays is a `removeClip`, not a side effect. The file on disk is never touched.

**Deleting a project is left out on purpose.** It cannot be undone, no checkpoint holds a deleted file, and nothing an agent makes needs it. The user deletes projects in the app.

## Transcription

`transcribe` runs the on-device Whisper on one asset and stores its transcript, which `getTranscriptWords`, `removeWords` and the captions read. A take from `stopRecording` has none until it runs; the editor makes one on its own when it opens a project.

- **Outside the queue.** Whisper takes minutes, so the runner does not hold its queue for it: other calls go on, and only the landing is queued, as a `RunnerEdit` on the project as it is by then (`applyTranscriptionResult`: the transcript replaced, the word corrections that still match carried over, a remembered failure cleared, as the editor's queue lands one).
- **The project open in an editor of this process** goes to that editor's own queue (`McpDocumentHost.transcribe` → `ensureTranscript`): a job already queued or running for the asset is waited for, never doubled. The host waits up to an hour, and answers at once when the editor goes away.
- **Any other project** runs `SttManager.transcribe` in this process with the asset's path and the project's vocabulary as Whisper's prompt, one MCP transcription at a time. No runner window is needed: the engine and its ffmpeg decode already live in the main process. The renderer's own decode, the editor's fallback for an install with no ffmpeg, is not available there.
- **Without `language`** a transcript already there is returned unchanged; with one (or `auto`) the asset is transcribed again.
- **Failures** are classified as the editor classifies them (`classifyTranscriptionError`), and a deterministic one (no audio, unreadable codec) is remembered on the asset (`withTranscriptionFailure`).
- **No checkpoint is needed** on a closed project, since `restoreCheckpoint` keeps the transcript anyway.
- **Forwarded** from `openscreen mcp` to the app like every tool, with a 65-minute timeout instead of 90 s, and never run again locally after a lost answer. With no app, `openscreen mcp` transcribes in its own process and stops the Whisper helper before it exits.

## The media tools

`createMediaTools` builds the tools that make a video around the edits, once per `openscreen mcp` process, and `createOpenScreenMcpServer` registers them. Their state (the take running, the export running, each take's start time, each project's last export) lives in what `createMediaTools` returns. They run in the `openscreen mcp` process whether or not the app runs; what they share with the document tools is the runner (the routed one of `stdio-server.ts`), so their document calls go to the app while it runs.

- `startRecording` records in a hidden `cli-record` runner of its own process, as `openscreen record`, with the same request (`CliRecordRequest`: source, microphone, camera, system audio, cursor mode). The app's recording bar is not involved, and the user's recording settings are untouched: the runner never saves them. On Linux the desktop's own picker asks the user which window to record.
- `stopRecording` stops the runner and makes the project in the same process (`createProjectFromVideo`): a fresh id no editor can hold, the zooms planned from the clicks, and the webcam, when one was recorded, linked to the take's asset as the editor links it (its offset and size). The project is in the app's project list, for the user to open. It then creates the take's checkpoint through the runner, and records when the take started, by its video, for `setPointerTrack`.
- `setPointerTrack` gives a script-driven take a pointer track and plans zooms on its clicks. `pointerTrackEdit` computes the new sidecar and the zooms from the project the runner read, writes nothing itself, and hands both to the runner as a `RunnerEdit`. The runner then applies the same refusals as any edit (another process's editor, no checkpoint, a project changed mid-call) before writing anything, saves the project, and only then writes the sidecar, keeping its previous content for the checkpoints. Every refusal comes back as the tool's own text result. A sidecar write that fails after the save is reported as a partial edit: the project was saved, the pointer track was not. A `RunnerEdit` is a closure and cannot be forwarded, so the call carries what the edit needs (`events`, `takes`, each take's start time by video, and the client's `recordingStartedAt` when it gave one): the app's channel serves `setPointerTrack` with those args and runs `pointerTrackEdit` in its own runner. That is the channel's own registration, not the media tools': the takes of `openscreen mcp` are known to it alone.
- A video no take recorded, such as a capture a script made frame by frame and gave to `createProject`, has no start time on the server. The client passes `recordingStartedAt` on the clock of its events' `at`, and it wins over a take's own start when both exist. Without either, `pointerTrackEdit` refuses and names the parameter.
- `exportVideo` renders in a hidden `cli-export` runner. The runner reads the project by id (`CliExportRequest.projectId`, the editor's own `aiEdition.get`), not by path: opening a file by path moves the main process's current project and recording-session slot.
- `exportVideo` takes the Export dialog's options and choices: `quality` and `fps` (24, 30, 60) for an MP4, `gifFrameRate`, `gifSize` and `gifLoop` for a GIF, the dialog's defaults when left out. An option of the other format is refused rather than ignored. Hiding the desktop icons is not a `startRecording` option: it follows the user's Record mode setting. Nor are the CLI's `--auto-zoom` and `--audio`: zooms and a voiceover are edits of the project, and an export that added them would not be the project `getFrames` maps through.
- `exportAudio` (#1280) is the same runner with `format` `wav` or `m4a`: `CliExportRunner` renders the MP4 beside the output (`audioRenderPath`, removed by `createRunnerHost` once the run reports) and `extractAudio` takes its audio stream out, so the file is the MP4's own mix, not a second mixer's. With `audioId` (`CliExportRequest.audioTrackId`, the CLI's `--track`), `isolateAudioTrack` keeps that track's fragments only, the clips render with `hasAudio: false` and the click sound is dropped: the track alone, where the export places it. There is no option to replace the take's sound for the whole programme: the document has no such switch (the take's gain is bounded at ±12 dB), and an export option would make a file the project does not describe.
- `exportCaptions` writes the captions to a `.srt` or `.vtt` with no runner (`captions/subtitleFile.ts`): the cues the burn-in draws (`deriveCaptionCues`, whether or not the captions are on), each edge projected onto the export's clock with `projectRawTimelineSecToPlayback`, the exporter's own projection through trims and speed regions. `language` picks a translation layer, `null` the transcript's words, omitted what the captions show. A project with no words on its caption lane is refused and nothing is written.
- `exportVideo`, `exportAudio`, `exportCaptions`, `getAudioReport`, `getFrames`, `getContactSheet` and `getBeforeAfter` read projects; they write none. A relative output path is resolved against the server's working directory.
- `getFrames` with a `projectId` reads the project's last export while it is current. With no export, or one the project changed after, it renders the frames from the project instead (`renderFrames` in the addon, through the export's own walk), so an agent checks an edit without exporting. See [docs/shader-effects.md](../../docs/shader-effects.md), E.4.
- `getFrames` and `getContactSheet` find their frames the same way (`shotsOf`): explicit `atSec`, or `count` of them, spread over the whole video or from `startSec` to `endSec`, both ends shown. What differs is what they do with them.
  - `getFrames` returns each frame as an image, 1280 pixels wide at most. With a `region` it asks for the frame at its own size instead and returns that part of it, so a client reads small text or checks an edge at the export's resolution.
  - `getContactSheet` asks for the frames at the width of a tile and lays up to 36 of them on one image, each with its time in its corner ([`contact-sheet.ts`](../../electron/mcp/contact-sheet.ts)). One image is what a client pays for the rhythm of a whole film, or for a zoom or a cut frame by frame.
  - The pixel work (decoding a frame, cropping it, encoding the sheet) is Electron's `nativeImage` ([`frame-images.ts`](../../electron/mcp/frame-images.ts)), handed to the tools as `images` so they still import no `electron`. The layout and the labels are plain code on pixel buffers, with a small built-in font for the times: no canvas, no window and no dependency.
- `getBeforeAfter` shows what a series of edits changed: up to six moments, each rendered twice through `renderProjectShots`, once from a checkpoint's document and once from the project as it is, and laid in pairs on one sheet. `changedRegion` then compares each pair pixel by pixel and reports the share that changed and the box around it, in fractions of the whole frame: the `region` `getFrames` takes, so a client goes from "something moved" to reading it at full resolution in one call. It needs the addon's `renderFrames`: an export shows one state only. A checkpoint's side is its document rendered today: the pointer track is a file beside the video, read as it is now on both sides, so a `setPointerTrack` made since shows through the zooms it added and not through the pointer.
  - The checkpoints are the tool runner's, and while the app runs they are the app's. The tool reads one through the runner's own `readCheckpoint` (`READ_CHECKPOINT_TOOL`), which no client is served: the app's channel registers it, so `routeToApp` forwards the read where the checkpoint lives. Against an app too old to serve it the read runs locally and answers that the checkpoint is unknown.
- `getAudioReport` is how a client checks a mix it cannot hear. It renders the project's audio to a temporary WAV through `exportAudio`'s own path, so what it measures is the MP4's mix, then removes the file. [`audio-report.ts`](../../electron/mcp/audio-report.ts) reads it in chunks and measures the integrated loudness (ITU-R BS.1770-4 with the EBU R128 gates), the true peak on a signal oversampled four times, and every stretch of half a second or more under -60 dBFS. The stretches are in the export's seconds; the tool maps them back to ruler seconds (`rulerSecOf`), the clock of every other tool.
- `createProject` makes a project with `DocumentService.createProject`, so it starts in the look new projects take (the preset marked for them, else the last edited project's), as the editor's New does. With a `videoPath` it lays the video out with `createProjectFromVideo`, the path a take goes through: one clip, measured, and the zooms on its clicks when a pointer track sits beside it. Either way it returns a checkpoint, as `stopRecording` does, so the client can edit the closed project at once. It runs in the `openscreen mcp` process: a new project is one no editor holds.

## `openscreen mcp` and the running app

The stdio server (`openscreen mcp`, [`stdio-server.ts`](../../electron/mcp/stdio-server.ts)) is a process apart from the app. **When the app runs, it is the authority** (#1174): `listProjects`, every document tool, the project tools, both checkpoint tools and `setPointerTrack` are forwarded to it, and the app runs them through its one runner. The project open in the editor is then edited through the editor, live and one undo step per call, and checkpoints live in one place. The other media tools (record, export, `getFrames`, `listSources`, `createProject`) stay in the `openscreen mcp` process.

- **Channel.** MCP itself, over a Windows named pipe (a fresh random name per launch) or a Unix socket (`<userData>/mcp.sock`, mode 0600). The app serves `createOpenScreenMcpServer` on it, `openscreen mcp` is its client and forwards each `tools/call` unchanged. The handshake lists the app's tools, so a tool an older app lacks runs locally.
- **Discovery.** Once listening, the app writes `<userData>/mcp-app.json` (`{ pid, endpoint, token }`, mode 0600) and removes it as it quits. `openscreen mcp` shares that userData and reads the file on each call it is not connected for: the app starting or quitting mid-session is picked up on the next call. A file whose pid is dead, or whose endpoint does not answer within 3 s, is a crashed app's and is ignored.
- **Trust.** Every connection must first send the token from that file, or it is dropped. Node cannot set a named pipe's DACL, and the default one lets any user open it read-only; the token, in a file inside the user's profile, is what limits the channel to the current user. Any process of that user can connect, which grants nothing new: it could run `openscreen mcp` itself. The token is the channel's own, generated per launch and never shown: the user configures nothing.
- **Fallback.** With no app, or one that does not answer, the calls run in the `openscreen mcp` process on the files. The project a live app's editor holds is then still refused (#1138): the app's `.open-in-editor.json` marker says so, and the refusal asks to retry, close the project, or restart or update OpenScreen.
- **Never twice.** A call the app received but did not answer within 90 s (65 minutes for `transcribe`), or whose connection dropped, is not run again locally unless it is a read: the client is told the outcome is unknown and to re-read. The connection is dropped, so a hung app does not hold later calls.
- **Checkpoints do not cross over.** One made while the app answered lives in the app and is gone once it quits; one made while no app was reachable (before the call was sent) lives in the `openscreen mcp` process and is unknown to the app. A `createCheckpoint` the app received but never answered creates none here: it gets the unknown-outcome error like any other write. Either way the restore says the checkpoint is unknown, and an edit to a closed project asks for a new one.

## Transport and security

- One `McpServer` on the process's stdin/stdout for the whole session. It exits when stdin ends, closes or errors, whichever the client's pipe reports.
- No port and no token: only the client that launched the process can talk to it, with the user's rights, as it would run `openscreen record` or `openscreen export`. Nothing listens on the network. Its own channel to the app, a named pipe or a Unix socket, is described [above](#openscreen-mcp-and-the-running-app).
- The app stores nothing for it: no setting turns the server on, and no credential of the client or its model reaches OpenScreen.

**What is counted**

- Each call a client makes is counted by its tool's name, for the daily usage ping to carry (`countToolCall` in [`usage-ping.ts`](../../electron/usage-ping.ts)). `McpToolDeps.onToolCall` is told the name from one wrapper around `registerTool` (`countingToolCalls`), so the document tools and the media tools are counted alike. Nothing of the call is passed: no argument, no path, no result. The name is checked against the shape of a tool name before it is stored.
- A call is counted once, where the client made it. The app's channel has no `onToolCall`: the `openscreen mcp` process counted the call itself.
- The opt-outs are the ping's own: the tray's **Send Anonymous Usage Count**, `DO_NOT_TRACK`, CI and development builds count nothing, and unticking the tray's box drops what was counted. The counts ride the ping that already goes out, so counting adds no connection.

## Lifecycle

`registerIpcHandlers` builds the tool dependencies (`mcpToolDeps`: the cursor reader, the compositor's checks, the style presets, Whisper) and the app's one runner (`createToolRunner`), and returns them. In the app, `main.ts` opens the channel for `openscreen mcp` (`serveAppChannel`) with them, always, and closes it on `will-quit`. The headless CLI shares `registerIpcHandlers`: `openscreen mcp` reuses the same dependencies with `transport: "stdio"`, builds its own runner and media tools (`serveMcpOverStdio`), and never opens a channel, since only the app, under its single-instance lock, serves a userData.

## Connecting a client

The client starts the executable itself ([where it is on each platform](../../docs/cli.md#running-the-cli)):

```sh
claude mcp add openscreen -- "<executable>" mcp
codex mcp add openscreen -- "<executable>" mcp
```

The plugin in [`plugin/`](../../plugin/README.md) registers the same server for Claude Code and Codex and adds the skills that use it. Nothing is set up in the app.

## Known gaps

- **`openscreen mcp` records in its own process, app or no app.** Only its document calls are forwarded; its takes, exports and frames stay in the `openscreen mcp` process, and its take lands in the project list rather than in the editor. An agent cannot record through the app's recording bar, nor wait for a take the user makes there.
- **No Ctrl+Z for edits to closed projects.** Their undo is the checkpoint the write requires, which lives in memory: it is gone once the process holding it goes away or 20 newer ones push it out, and the edits stay.
- **An editor that stops answering looks closed.** A snapshot unanswered for 30 s reads as "no project open", so an edit naming the project that editor holds would go to its file, and the editor's next save would drop it. It takes a renderer hung for 30 s.
- **No project deletion**, on purpose ([above](#the-project-and-its-media)).
- **An imported recording comes without its camera.** The editor's import links the webcam an OpenScreen recording was made with (`find-recording-camera`); `importMedia` and `createProject` do not, so the camera of a recording imported over MCP is not in the project.
- **A transcription reports no progress.** `transcribe` answers once Whisper is done, which can outlast a client's own tool timeout on a long recording. In the app, the editor cancelling its own run (a regenerate in another language) also stops an MCP run of the same engine, which then reports a failure.
- **Cursor telemetry is read once per call.** It goes through an injected `CursorTelemetryReader` (`electron/ipc/handlers.ts` builds the only production one, behind `resolveApprovedVideoPath`), with no cache: `getCursorTrack` and the three zoom writes, which need it to report `cursorAnchor`, each read the sidecar in full. N separate `addZoom` calls therefore re-read the same file N times; `addZooms` is what keeps a whole zoom pass to one read. A runtime with no reader wired answers `reason: "unavailable"` and reports `hasCursorTelemetry: null`.
- **Clicks other than the left one reach the model as moves.** `readCursorSidecar`'s normalizer flattens `double-click` / `right-click` / `middle-click` to `move` before the track is built. The narrowing is upstream, in `CursorRecordingSample`.
