// Key press telemetry: the keyboard's counterpart of `<video>.cursor.json`.
//
// A take recorded with "Key sounds" on gets a `<video>.keys.json` sidecar: WHEN each key went
// down and up, on the recording's own clock. It never says which key. Each sample carries a
// coarse `kind` (so Enter and Space can sound like themselves) and a `voice`, a number the
// capture service drew at random for that key for that take only, so the same key sounds the
// same and different keys sound different without the file naming any of them.
//
// On Linux the samples come from the key timing service (electron/native/keytickd). Nothing
// here is Linux-specific: any source that can fill this shape gets key sounds.

export const KEY_RECORDING_VERSION = 1;
export const KEY_RECORDING_SUFFIX = ".keys.json";

export const KEY_KINDS = ["key", "space", "enter", "backspace", "modifier"] as const;
export type KeyKind = (typeof KEY_KINDS)[number];

export interface KeyRecordingSample {
	/** Milliseconds from the start of the recording, paused stretches removed. */
	timeMs: number;
	type: "down" | "up";
	kind: KeyKind;
	/** 0–255. Stable for one key within one take, meaningless across takes. */
	voice: number;
}

export interface KeyRecordingData {
	version: typeof KEY_RECORDING_VERSION;
	provider: string;
	samples: KeyRecordingSample[];
}

/** One event as the capture source reports it: wall-clock time, not recording time. */
export interface KeyEvent {
	/** Wall-clock milliseconds (Unix epoch), the clock cursor telemetry is stamped on. */
	atMs: number;
	type: "down" | "up";
	kind: KeyKind;
	voice: number;
}

export interface KeyPauseRange {
	startMs: number;
	endMs: number;
}

/**
 * Puts wall-clock key events on the recording's clock: zero at `recordingStartMs`, with every
 * paused stretch cut out the way the video and the cursor telemetry cut it. Events from before
 * the recording started, or from inside a pause, are not part of the take and are dropped.
 */
export function buildKeyRecording(
	events: KeyEvent[],
	recordingStartMs: number,
	pauseRanges: KeyPauseRange[],
	provider: string,
): KeyRecordingData {
	const ranges = pauseRanges
		.map((range) => ({
			startMs: Math.max(0, Math.min(range.startMs, range.endMs)),
			endMs: Math.max(0, Math.max(range.startMs, range.endMs)),
		}))
		.filter((range) => Number.isFinite(range.startMs) && Number.isFinite(range.endMs))
		.filter((range) => range.endMs > range.startMs)
		.sort((a, b) => a.startMs - b.startMs);

	const samples: KeyRecordingSample[] = [];
	for (const event of events) {
		const rawMs = event.atMs - recordingStartMs;
		if (!Number.isFinite(rawMs) || rawMs < 0) continue;
		let pausedBeforeMs = 0;
		let insidePause = false;
		for (const range of ranges) {
			if (rawMs >= range.startMs && rawMs <= range.endMs) {
				insidePause = true;
				break;
			}
			if (rawMs > range.endMs) pausedBeforeMs += range.endMs - range.startMs;
		}
		if (insidePause) continue;
		samples.push({
			timeMs: Math.max(0, Math.round(rawMs - pausedBeforeMs)),
			type: event.type,
			kind: event.kind,
			voice: event.voice,
		});
	}
	samples.sort((a, b) => a.timeMs - b.timeMs);
	return { version: KEY_RECORDING_VERSION, provider, samples };
}

function isKeyKind(value: unknown): value is KeyKind {
	return typeof value === "string" && (KEY_KINDS as readonly string[]).includes(value);
}

/**
 * Reads a sidecar off disk. It is user data: a sample that is not well-formed is skipped, and
 * anything that is not a key recording at all reads as `null`, never as an exception.
 */
export function parseKeyRecording(value: unknown): KeyRecordingData | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Record<string, unknown>;
	if (candidate.version !== KEY_RECORDING_VERSION || !Array.isArray(candidate.samples)) {
		return null;
	}
	const samples: KeyRecordingSample[] = [];
	for (const raw of candidate.samples) {
		if (!raw || typeof raw !== "object") continue;
		const sample = raw as Record<string, unknown>;
		if (
			typeof sample.timeMs !== "number" ||
			!Number.isFinite(sample.timeMs) ||
			sample.timeMs < 0 ||
			(sample.type !== "down" && sample.type !== "up") ||
			!isKeyKind(sample.kind) ||
			typeof sample.voice !== "number" ||
			!Number.isInteger(sample.voice) ||
			sample.voice < 0 ||
			sample.voice > 255
		) {
			continue;
		}
		samples.push({
			timeMs: sample.timeMs,
			type: sample.type,
			kind: sample.kind,
			voice: sample.voice,
		});
	}
	samples.sort((a, b) => a.timeMs - b.timeMs);
	return {
		version: KEY_RECORDING_VERSION,
		provider: typeof candidate.provider === "string" ? candidate.provider : "unknown",
		samples,
	};
}
