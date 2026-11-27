// Key press sounds.
//
// The keyboard's counterpart of clickSound.ts, and built the same way on purpose: nothing is
// baked into a file. A take recorded with "Key sounds" on carries `<video>.keys.json` (see
// src/lib/keystrokes/keyRecording.ts): when each key went down and up, a coarse kind, and a
// per-key voice number. Those become short hits, placed by the same raw→programme projection as
// the clicks (`placedClickHits`), so a cut or a speed region moves them with the picture. The
// export sums them in the compositor (`mix_key_hits`, crates/compositor/src/audio.rs) and the
// preview plays them off the same list.
//
// WHICH SAMPLE. The sidecar never names a key. What makes typing sound like typing rather than
// one key hit again and again is that different keys sound different, so the voice picks one of
// several key samples and a small level trim: the same key always gets the same pair within a
// take, and two different keys usually do not. Space, Enter, Backspace and the modifiers have
// their own samples, because on a real keyboard they are the ones a listener can tell apart.

import type { KeyRecordingData, KeyRecordingSample } from "@/lib/keystrokes/keyRecording";
import {
	KEY_DOWN_SAMPLES,
	KEY_SOUND_SAMPLES,
	KEY_UP_SAMPLES,
	type KeySoundSample,
	keySampleFile,
} from "@/lib/keystrokes/keySoundSamples";
import { clickCuesFitTake, clickTakeOf, crossedClickHits, placedClickHits } from "./clickSound";
import type { AxcutAsset, AxcutDocument } from "./schema";
import { audioGainScalar, getEditorSettings } from "./store/editorSettings";

export const keySampleUrl = (sample: KeySoundSample) => `sounds/keys/${keySampleFile(sample)}`;

/** How loud a release is next to its press. */
const RELEASE_GAIN = 0.45;
/** A modifier is held, not struck: quieter than a typed key. */
const MODIFIER_GAIN = 0.7;
/** The most a key's own level trim takes off, as a fraction. Keys differ; none goes missing. */
const VOICE_TRIM = 0.18;
/** How far one press may sit above or below its key's level: fingers are not metronomes. */
const PRESS_JITTER = 0.1;

export interface KeyCue {
	/** Seconds from the start of the recording: source time, the sidecar's own clock. */
	timeSec: number;
	gain: number;
	sample: KeySoundSample;
	/** A key coming back up, not going down. */
	release: boolean;
}

export interface KeySoundScene {
	/** Absolute paths of the staged samples, in `KEY_SOUND_SAMPLES` order. */
	samples: string[];
	/** Programme seconds, the compositor's own clock; `sample` indexes `samples`. */
	hits: Array<{ timeSec: number; gain: number; sample: number }>;
}

/** A repeatable 0..1 value for the n-th sample of a take, so preview and export agree. */
function jitter(index: number, voice: number): number {
	let x = (index + 1) * 0x9e3779b1 + voice * 0x85ebca6b;
	x ^= x >>> 15;
	x = Math.imul(x, 0x2c1b3c6d);
	x ^= x >>> 12;
	return (x >>> 0) / 0xffffffff;
}

export function keySampleFor(sample: Pick<KeyRecordingSample, "type" | "kind" | "voice">) {
	if (sample.type === "up") return KEY_UP_SAMPLES[sample.voice % KEY_UP_SAMPLES.length];
	switch (sample.kind) {
		case "space":
			return "space";
		case "enter":
			return "enter";
		case "backspace":
			return "backspace";
		case "modifier":
			return "modifier";
		default:
			return KEY_DOWN_SAMPLES[sample.voice % KEY_DOWN_SAMPLES.length];
	}
}

/** One hit per recorded press and release. The samples are level-matched; a cue's gain is the
 *  only volume decision left, and it is a pure function of the sidecar. */
export function buildKeyCues(recording: KeyRecordingData | null | undefined): KeyCue[] {
	const cues: KeyCue[] = [];
	for (const [index, sample] of (recording?.samples ?? []).entries()) {
		if (!Number.isFinite(sample.timeMs) || sample.timeMs < 0) continue;
		// The voice's high bits trim the level, its low bits picked the sample: two keys that
		// share a sample still do not sound identical.
		const voiceTrim = 1 - VOICE_TRIM * ((sample.voice >> 4) / 15);
		const press = 1 + PRESS_JITTER * (jitter(index, sample.voice) * 2 - 1);
		let gain = voiceTrim * press;
		if (sample.kind === "modifier") gain *= MODIFIER_GAIN;
		if (sample.type === "up") gain *= RELEASE_GAIN;
		cues.push({
			timeSec: sample.timeMs / 1000,
			gain,
			sample: keySampleFor(sample),
			release: sample.type === "up",
		});
	}
	return cues.sort((a, b) => a.timeSec - b.timeSec);
}

export function levelKeyCues(cues: KeyCue[], gainDb: number): KeyCue[] {
	const scalar = audioGainScalar(gainDb);
	return scalar === 1 ? cues : cues.map((cue) => ({ ...cue, gain: cue.gain * scalar }));
}

// One-shot caches, as for the clicks: a finished take's sidecar never changes, and the staged
// samples are the same bytes in every project.
const cueCache = new Map<string, KeyCue[]>();
let samplePaths: string[] | null = null;
let samplePathsPending: Promise<string[] | null> | null = null;

/** The take's key cues, read from disk once per run. A take with no sidecar holds none. */
export async function loadKeyCues(takePath: string): Promise<KeyCue[]> {
	const cached = cueCache.get(takePath);
	if (cached) return cached;
	let cues: KeyCue[] = [];
	try {
		cues = buildKeyCues(await window.electronAPI?.getKeyRecording?.(takePath));
	} catch (error) {
		console.error("Failed to read the key telemetry of", takePath, error);
	}
	cueCache.set(takePath, cues);
	if (previewTake === takePath && previewEdit) {
		stashPreviewCues(previewEdit.document, previewEdit.take, levelKeyCues(cues, previewGainDb));
	}
	return cues;
}

/** Drops a take's cached cues: its sidecar was rewritten (the agent's setKeyTrack). */
export function forgetKeyCues(takePath: string): void {
	cueCache.delete(takePath);
}

/** The samples as files the compositor can open, staged once through the main process. */
export function ensureKeySamplePaths(): Promise<string[] | null> {
	if (samplePaths) return Promise.resolve(samplePaths);
	samplePathsPending ??= stageKeySamples().finally(() => {
		samplePathsPending = null;
	});
	return samplePathsPending;
}

async function stageKeySamples(): Promise<string[] | null> {
	const stage = window.electronAPI?.stageClickSoundHit;
	if (!stage) return null;
	const staged: string[] = [];
	for (const sample of KEY_SOUND_SAMPLES) {
		const response = await fetch(new URL(keySampleUrl(sample), window.location.href).href);
		if (!response.ok) return null;
		const saved = await stage(keySampleFile(sample), await response.arrayBuffer());
		if (!saved?.success || !saved.path) return null;
		staged.push(saved.path);
	}
	samplePaths = staged;
	return samplePaths;
}

/**
 * The scene's `keySound` block for this document, or null when there is nothing to play.
 * Synchronous, like `clickSoundForDocument` and for the same reason: an unread take is read in
 * the background, and an export awaits `prepareKeySound` first.
 */
export function keySoundForDocument(
	document: AxcutDocument,
	keys: { keySound: boolean; keySoundGainDb: number },
): KeySoundScene | null {
	const take = keys.keySound ? clickTakeOf(document) : undefined;
	const takePath = take?.originalPath;
	previewGainDb = keys.keySoundGainDb;
	if (!takePath || !take) {
		previewEdit = null;
		previewTake = undefined;
		previewByClip.clear();
		previewCues = [];
		return null;
	}
	// The main process builds scenes too and has no renderer bridge; it renders pictures only.
	if (!cueCache.has(takePath) && typeof window !== "undefined") void loadKeyCues(takePath);
	const cues = levelKeyCues(cueCache.get(takePath) || [], keys.keySoundGainDb);
	stashPreviewCues(document, take, cues);
	if (!samplePaths || cues.length === 0) return null;
	return {
		samples: samplePaths,
		hits: placedClickHits(document, take, cues).map(({ sec, cue }) => ({
			timeSec: sec,
			gain: cue.gain,
			sample: KEY_SOUND_SAMPLES.indexOf(cue.sample),
		})),
	};
}

/** Loads what the sound needs for `document`: its cues, and the samples staged for the export. */
export async function prepareKeySound(document: AxcutDocument): Promise<void> {
	const settings = getEditorSettings(document);
	if (!settings.keySound) return;
	const take = clickTakeOf(document);
	if (!take?.originalPath) return;
	previewGainDb = settings.keySoundGainDb;
	const cues = await loadKeyCues(take.originalPath);
	stashPreviewCues(document, take, levelKeyCues(cues, settings.keySoundGainDb));
	await ensureKeySamplePaths();
}

// ── Preview ────────────────────────────────────────────────────────────────────────────────
// Same shape as the clicks' preview state: the scene build stashes what may sound, already at
// the user's level and filtered by the edit, and the preview's frame tick drains it by crossings
// of the take's own source clock.

let previewCues: KeyCue[] = [];
const previewByClip = new Map<string, KeyCue[]>();
let previewTake: string | undefined;
let previewGainDb = 0;
let previewEdit: { document: AxcutDocument; take: AxcutAsset } | null = null;
let lastSourceSec = Number.NaN;
let playheadGeneration = 0;

function stashPreviewCues(document: AxcutDocument, take: AxcutAsset, leveledCues: KeyCue[]) {
	previewEdit = { document, take };
	previewTake = take.originalPath;
	previewByClip.clear();
	const kept = new Set<KeyCue>();
	for (const placed of placedClickHits(document, take, leveledCues)) {
		kept.add(placed.cue);
		const bucket = previewByClip.get(placed.clipId) ?? [];
		bucket.push(placed.cue);
		previewByClip.set(placed.clipId, bucket);
	}
	previewCues = [...kept].sort((x, y) => x.timeSec - y.timeSec);
}

/** The key hits the playhead passed since the last call, in the take's own source seconds. */
export function takeCrossedKeyHits(
	sourceSec: number,
	mountedTakePath?: string | null,
	mountedClipId?: string | null,
): KeyCue[] {
	const fit = clickCuesFitTake(previewTake, mountedTakePath);
	const cues = mountedClipId ? (previewByClip.get(mountedClipId) ?? []) : previewCues;
	// `crossedClickHits` is also the seek detector: a jump owes no hits.
	const crossed = fit ? crossedClickHits(cues, lastSourceSec, sourceSec) : [];
	lastSourceSec = sourceSec;
	return crossed;
}

export function resetKeyPlayhead(): void {
	lastSourceSec = Number.NaN;
	playheadGeneration += 1;
}

const sampleBuffers = new WeakMap<AudioContext, Promise<Map<KeySoundSample, AudioBuffer>>>();

async function decodeSample(context: AudioContext, sample: KeySoundSample) {
	// A sample the user replaced (userData/sounds) is what the export will mix, so it is what
	// the preview plays too; the bundled one is the fallback.
	const custom = await window.electronAPI
		?.readSoundOverride?.(keySampleFile(sample))
		.catch(() => null);
	if (custom) return context.decodeAudioData(custom);
	const response = await fetch(new URL(keySampleUrl(sample), window.location.href).href);
	if (!response.ok) throw new Error(`Failed to fetch ${sample}`);
	return context.decodeAudioData(await response.arrayBuffer());
}

function keySampleBuffers(context: AudioContext) {
	let pending = sampleBuffers.get(context);
	if (!pending) {
		pending = Promise.all(
			KEY_SOUND_SAMPLES.map(async (sample) => {
				// One sample that will not decode silences that sample, not the keyboard.
				const buffer = await decodeSample(context, sample).catch(() => null);
				return [sample, buffer] as const;
			}),
		).then((entries) => {
			const buffers = new Map<KeySoundSample, AudioBuffer>();
			for (const [sample, buffer] of entries) if (buffer) buffers.set(sample, buffer);
			return buffers;
		});
		sampleBuffers.set(context, pending);
	}
	return pending;
}

function playKeyHits(context: AudioContext, destination: AudioNode, cues: KeyCue[]) {
	const generation = playheadGeneration;
	void keySampleBuffers(context)
		.then((buffers) => {
			if (context.state === "closed" || generation !== playheadGeneration) return;
			for (const cue of cues) {
				const buffer = buffers.get(cue.sample);
				if (!buffer) continue;
				const source = context.createBufferSource();
				source.buffer = buffer;
				const gain = context.createGain();
				gain.gain.value = cue.gain;
				source.connect(gain).connect(destination);
				source.start();
			}
		})
		.catch(() => undefined);
}

/**
 * The preview's whole part in the key sound, called once per frame beside the click sound's:
 * while stopped the anchor is dropped, while playing the hits the playhead crossed are heard.
 */
export function tickKeySoundPreview(
	paused: boolean,
	sourceSec: number,
	mountedTakePath: string | null | undefined,
	mountedClipId: string | null | undefined,
	graph: { context: AudioContext; gain: AudioNode } | null | undefined,
): void {
	if (paused) {
		resetKeyPlayhead();
		return;
	}
	const crossed = takeCrossedKeyHits(sourceSec, mountedTakePath, mountedClipId);
	if (crossed.length && graph) playKeyHits(graph.context, graph.gain, crossed);
}
