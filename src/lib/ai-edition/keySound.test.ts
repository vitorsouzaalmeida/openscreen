import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyRecordingData, KeyRecordingSample } from "@/lib/keystrokes/keyRecording";
import { KEY_SOUND_SAMPLES } from "@/lib/keystrokes/keySoundSamples";
import {
	buildKeyCues,
	keySampleFor,
	keySoundForDocument,
	levelKeyCues,
	loadKeyCues,
	resetKeyPlayhead,
	takeCrossedKeyHits,
} from "./keySound";

const recording = (samples: KeyRecordingSample[]): KeyRecordingData => ({
	version: 1,
	provider: "test",
	samples,
});
const press = (timeMs: number, voice: number, kind: KeyRecordingSample["kind"] = "key") =>
	({ timeMs, type: "down", kind, voice }) as const;

describe("keySampleFor", () => {
	it("gives the same key the same sample, and spreads keys across the samples", () => {
		expect(keySampleFor(press(0, 41))).toBe(keySampleFor(press(999, 41)));
		const used = new Set(Array.from({ length: 256 }, (_, voice) => keySampleFor(press(0, voice))));
		expect(used.size).toBe(9);
	});

	it("gives Space, Enter, Backspace and modifiers their own sample whatever the voice", () => {
		for (const voice of [0, 7, 255]) {
			expect(keySampleFor(press(0, voice, "space"))).toBe("space");
			expect(keySampleFor(press(0, voice, "enter"))).toBe("enter");
			expect(keySampleFor(press(0, voice, "backspace"))).toBe("backspace");
			expect(keySampleFor(press(0, voice, "modifier"))).toBe("modifier");
		}
	});

	it("plays a release sample for every kind of key", () => {
		for (const kind of ["key", "space", "enter", "backspace", "modifier"] as const) {
			expect(keySampleFor({ type: "up", kind, voice: 4 })).toMatch(/^key-up-/);
		}
	});

	it("only ever names a sample the app ships", () => {
		for (let voice = 0; voice < 256; voice++) {
			for (const type of ["down", "up"] as const) {
				expect(KEY_SOUND_SAMPLES).toContain(keySampleFor({ type, kind: "key", voice }));
			}
		}
	});
});

describe("buildKeyCues", () => {
	it("is empty for a take with no key recording", () => {
		expect(buildKeyCues(null)).toEqual([]);
		expect(buildKeyCues(recording([]))).toEqual([]);
	});

	it("puts one cue per sample on the take's clock, in order", () => {
		const cues = buildKeyCues(
			recording([press(2000, 3), { timeMs: 500, type: "up", kind: "key", voice: 3 }]),
		);
		expect(cues.map((cue) => cue.timeSec)).toEqual([0.5, 2]);
	});

	it("is repeatable: the preview and the export hear the same levels", () => {
		const samples = [press(100, 12), press(200, 200), press(300, 12)];
		expect(buildKeyCues(recording(samples))).toEqual(buildKeyCues(recording(samples)));
	});

	it("does not play the same key at the same level twice in a row, nor far apart", () => {
		const cues = buildKeyCues(recording([press(100, 12), press(200, 12), press(300, 12)]));
		const gains = cues.map((cue) => cue.gain);
		expect(new Set(gains).size).toBeGreaterThan(1);
		for (const gain of gains) {
			expect(gain).toBeGreaterThan(0.7);
			expect(gain).toBeLessThanOrEqual(1.1);
		}
	});

	it("makes a release quieter than its press, and a modifier quieter than a key", () => {
		const [down, up] = buildKeyCues(
			recording([press(100, 0), { timeMs: 180, type: "up", kind: "key", voice: 0 }]),
		);
		expect(up.gain).toBeLessThan(down.gain * 0.6);
		const [modifier] = buildKeyCues(recording([press(100, 0, "modifier")]));
		expect(modifier.gain).toBeLessThan(0.8);
	});

	it("skips a sample whose time is not a time", () => {
		expect(
			buildKeyCues(recording([press(Number.NaN, 1), press(-5, 1), press(10, 1)])),
		).toHaveLength(1);
	});
});

describe("a key press and its release", () => {
	const release = (timeMs: number, voice: number) =>
		({ timeMs, type: "up", kind: "key", voice }) as const;

	it("names a release after the press of its key, however the keys overlap", () => {
		// Two keys rolled: the second goes down before the first comes up.
		const cues = buildKeyCues(
			recording([press(100, 3), press(150, 9), release(220, 3), release(260, 9)]),
		);
		expect(cues.map((cue) => [cue.timeSec, cue.pressMs])).toEqual([
			[0.1, 100],
			[0.15, 150],
			[0.22, 100],
			[0.26, 150],
		]);
	});

	it("pairs the same key pressed twice with its own release each time", () => {
		const cues = buildKeyCues(
			recording([press(100, 3), release(180, 3), press(300, 3), release(390, 3)]),
		);
		expect(cues.map((cue) => cue.pressMs)).toEqual([100, 100, 300, 300]);
	});

	it("lets a release with no press before it stand for itself", () => {
		// The key was already held when the take started.
		expect(buildKeyCues(recording([release(40, 7)]))[0].pressMs).toBe(40);
	});
});

describe("a silenced key press", () => {
	const take = { id: "asset_keys", kind: "video", originalPath: "/keys.mp4", durationSec: 10 };
	const document = (mutedInputSounds?: unknown[]) =>
		({
			project: { primaryAssetId: take.id },
			assets: [take],
			audioTracks: [],
			timeline: {
				clips: [
					{
						id: "clip_1",
						assetId: take.id,
						timelineStartSec: 0,
						timelineEndSec: 10,
						sourceStartSec: 0,
						sourceEndSec: 10,
					},
				],
				trimRanges: [],
				speedRanges: [],
			},
			legacyEditor: { speedRegions: [] },
			...(mutedInputSounds ? { mutedInputSounds } : {}),
		}) as never;

	afterEach(() => vi.unstubAllGlobals());

	it("is left out of what sounds, its release with it, and the others still sound", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				getKeyRecording: async () =>
					recording([
						press(1000, 3),
						{ timeMs: 1080, type: "up", kind: "key", voice: 3 },
						press(2000, 9),
						{ timeMs: 2090, type: "up", kind: "key", voice: 9 },
					]),
			},
		});
		await loadKeyCues(take.originalPath);
		const crossed = (fromSec: number, toSec: number) => {
			resetKeyPlayhead();
			takeCrossedKeyHits(fromSec, take.originalPath);
			return takeCrossedKeyHits(toSec, take.originalPath).map((cue) => cue.timeSec);
		};

		keySoundForDocument(document(), { keySound: true, keySoundGainDb: 0 });
		expect(crossed(0.9, 1.2)).toEqual([1, 1.08]);

		keySoundForDocument(document([{ assetId: take.id, kind: "key", timeMs: 1000 }]), {
			keySound: true,
			keySoundGainDb: 0,
		});
		expect(crossed(0.9, 1.2)).toEqual([]);
		expect(crossed(1.9, 2.2)).toEqual([2, 2.09]);

		// A click silenced at the same millisecond is another kind: the key still sounds.
		keySoundForDocument(document([{ assetId: take.id, kind: "click", timeMs: 1000 }]), {
			keySound: true,
			keySoundGainDb: 0,
		});
		expect(crossed(0.9, 1.2)).toEqual([1, 1.08]);
	});
});

describe("levelKeyCues", () => {
	it("applies the user's level to every cue, and leaves 0 dB alone", () => {
		const cues = buildKeyCues(recording([press(100, 5)]));
		expect(levelKeyCues(cues, 0)).toBe(cues);
		expect(levelKeyCues(cues, -6)[0].gain).toBeCloseTo(cues[0].gain * 10 ** (-6 / 20), 5);
	});
});
