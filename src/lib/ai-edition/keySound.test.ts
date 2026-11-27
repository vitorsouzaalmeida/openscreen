import { describe, expect, it } from "vitest";
import type { KeyRecordingData, KeyRecordingSample } from "@/lib/keystrokes/keyRecording";
import { KEY_SOUND_SAMPLES } from "@/lib/keystrokes/keySoundSamples";
import { buildKeyCues, keySampleFor, levelKeyCues } from "./keySound";

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

describe("levelKeyCues", () => {
	it("applies the user's level to every cue, and leaves 0 dB alone", () => {
		const cues = buildKeyCues(recording([press(100, 5)]));
		expect(levelKeyCues(cues, 0)).toBe(cues);
		expect(levelKeyCues(cues, -6)[0].gain).toBeCloseTo(cues[0].gain * 10 ** (-6 / 20), 5);
	});
});
