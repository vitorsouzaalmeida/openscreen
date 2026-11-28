# Key sounds

A take recorded with **Key sounds** on plays a sound for every key press and release, in the
preview and in the export. The sounds follow cuts and speed regions exactly as the click sound
does, and each key has its own voice, so typing does not sound like one key hit repeatedly.

OpenScreen never learns which keys were pressed. This page describes how that is kept true, and
where each part lives.

## The parts

| Part | Where | What it does |
| --- | --- | --- |
| Key timing service | `electron/native/keytickd/` | Reads the keyboards. Hands one authorized client press and release times, a key class and a voice number. Linux only. |
| Service client | `electron/keystrokes/keytickClient.ts` | The app's end of the service's socket. |
| Take orchestration | `electron/keystrokes/keySoundsRecording.ts`, hooks in `electron/ipc/handlers.ts` | Starts and stops listening around a take, writes the sidecar. |
| Sidecar format | `src/lib/keystrokes/keyRecording.ts` | `<video>.keys.json`, the keyboard's `<video>.cursor.json`. |
| Sound | `src/lib/ai-edition/keySound.ts` | Turns the sidecar into hits, places them on the edit, plays them in the preview. |
| Export mix | `mix_key_hits` in `crates/compositor/src/audio.rs` | Sums the hits into the programme. |
| Samples | `public/sounds/keys/`, names in `src/lib/keystrokes/keySoundSamples.ts` | The sounds themselves. |

## Why a separate service

On Wayland the only source of global key events is evdev (`/dev/input/event*`). Giving the user's
own account read access to a keyboard node, through the `input` group or a udev rule, lets every
program that runs as that user log keystrokes. The capture helper therefore promises never to
read a keyboard (`electron/native/pipewire-capture/src/input.rs`), and that promise is unchanged.

`openscreen-keytickd` holds the access instead:

- It runs as its own account, `openscreen-keytick`, whose only privilege is the `input` group.
  Its systemd unit removes everything else: no network, no capabilities, a read-only system, no
  home directories, input devices only.
- It is socket-activated and exits when idle. It opens the keyboards only between a client's
  `start` and `stop`.
- A client is authorized through polkit (`org.openscreen.keytick.capture`). Only a process in
  the active local session can be authorized, and only by the user typing their password. A
  program running as the user can ask, but cannot answer the prompt.
- Authorization is per connection. The app keeps one connection for its lifetime, so the user is
  asked once per app session.

## What leaves the service

One line per key press or release, and nothing else:

```json
{"type":"key","t":1795755070420,"e":"d","c":"key","v":137}
```

- `t`: wall-clock milliseconds, from the kernel's own event timestamp. The capture helper stamps
  clicks on the same clock.
- `e`: `d` (down) or `u` (up). Autorepeat is dropped: a held key is one press.
- `c`: `key`, `space`, `enter`, `backspace` or `mod`.
- `v`: a voice number, 0 to 255. It is drawn at random for each key the first time that key is
  seen, and the table is thrown away on every `start` and `stop`. The same key keeps its voice
  for one take; nothing maps a voice back to a key, and two takes cannot be compared.

The key code is used to look up the class and the voice, and is never written. This is tested in
`electron/native/keytickd/src/protocol.rs`.

### What that still reveals

The sidecar, and the audio of an exported video, show when keys were pressed and which presses
were the same key. For text typed on screen that adds nothing. For a password typed during a
take, it is a hint about its length and its repeated characters. Turn **Key sounds** off before
a take that includes typing a secret.

## Recording

1. Turning the toggle on (`keySoundsEnabled` in the recording prefs) makes the main process ask
   the service to authorize, so the password prompt appears then and never over a take. A toggle
   the service cannot honour is turned back off, with the reason shown as a toast.
2. When a take starts, the main process sends `start` before the capture is armed. A connection
   that still owes its prompt gets it there, ahead of frame 0. A prompt left unanswered for 60
   seconds is abandoned and the take records without key timing.
3. When the take stops, the collected events are put on the take's clock: zero at the helper's
   `capture-started` timestamp, with the paused stretches removed
   (`LinuxNativeCaptureSession.recordingClock`). That is the cursor telemetry's zero and its
   pauses, so key times and click times line up.
4. The result is written beside the video as `<video>.keys.json`:

```json
{ "version": 1, "provider": "keytickd",
  "samples": [{ "timeMs": 1234, "type": "down", "kind": "key", "voice": 137 }] }
```

Nothing in the sidecar format is specific to Linux. Any source that can fill it gets key sounds.

## Sound

`keySound.ts` mirrors `clickSound.ts`, and reuses its placement (`placedClickHits`), so a key hit
goes through the same raw-to-programme projection as a click and as an imported audio track.

- A plain key press plays one of nine samples, picked by `voice % 9`; the voice's high bits trim
  its level a little, so two keys that share a sample still differ. Each press also gets a small
  repeatable level variation.
- Space, Enter, Backspace and the modifiers have their own samples.
- A release plays one of three quieter samples.

The scene description carries the hits in a `keySound` block (`samples`, and `hits` with a
programme time, a gain and a sample index). The preview plays the same list off the take's source
clock, beside the click sound's tick in `VirtualPreview.tsx`.

The editor settings are `keySound` (on by default: a take only has key timing when the user asked
for it) and `keySoundGainDb`. The row sits under the click sound's in the cursor pane and is
offered only for a take that has key timing.

## On the timeline

The take's clicks and key presses each have a lane under the audio lane (`InputLane.tsx`), drawn
only for a take that has them: a dot per click, a thin bar per key press. Presses closer together
than a mark is wide share one mark, so typing reads as its rhythm and zooming in separates the
keys. The clicks are the ones the project draws, a [cursor override](cursor.md#cursor-overrides)'s
included.

Nothing about a mark can be edited but whether it sounds. A press on a mark selects it; dragged
along the lane, or with Shift, it selects a stretch. The inspector's Sound switch, or Delete,
takes the sound out, and the mark stays, drawn hollow, so the same switch gives it back. A
silenced click keeps its bounce, its zoom and its pointer.

The silenced presses are stored in the project (`mutedInputSounds`, `inputSounds.ts`), each named
by its asset, its kind and the recording millisecond of its press. A release, and the second tap
of a double click, go with their press (`clickMs` on a click cue, `pressMs` on a key cue).
`clickSound.ts` and `keySound.ts` leave them out of the cues, so the preview and the export's hit
list agree; the compositor's mix is unchanged.

## Replacing the sounds

A file of the same name in `<userData>/sounds/` replaces a bundled sample, in the preview and in
the export. On Linux that folder is `~/.config/openscreen/sounds/`.

- Clicks: `click-down.wav`, `click-up.wav`.
- Keys: `key-1.wav` to `key-9.wav`, `key-up-1.wav` to `key-up-3.wav`, `space.wav`, `enter.wav`,
  `backspace.wav`, `modifier.wav`.

Files are read when the editor first needs them, so restart the app after changing one. A file
over 4 MB is ignored.

## Installing the service

The service is not installed with the app. It is built by `npm run build:native:keytickd` and
staged, with its systemd, sysusers and polkit files, in
`electron/native/bin/linux-<arch>/keytickd/`, which a packaged build ships under its resources.
Install it once:

```sh
sudo sh <resources>/electron/native/bin/linux-x64/keytickd/install.sh
```

Run it again after an update that changes the service. `uninstall.sh` in the same folder removes
it. Without the service the toggle stays visible on Linux, says why it cannot be turned on, and
everything else works as before.

## Not built

- Key capture on Windows and macOS.
- Showing pressed keys on screen.
- Agent tools to read or write the key track, or to silence one press. The agent can turn the
  sound on and off and set its level through `setEditorSettings`.
- Moving, adding or removing a key press. Only its sound can be taken out.
