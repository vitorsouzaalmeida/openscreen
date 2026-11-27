import { describe, expect, it } from "vitest";
import { buildKeyRecording, type KeyEvent, parseKeyRecording } from "./keyRecording";

const down = (atMs: number, voice = 1): KeyEvent => ({ atMs, type: "down", kind: "key", voice });

describe("buildKeyRecording", () => {
	it("puts wall-clock events on the recording's clock", () => {
		const recording = buildKeyRecording([down(10_500), down(11_000)], 10_000, [], "keytickd");
		expect(recording.samples.map((sample) => sample.timeMs)).toEqual([500, 1000]);
		expect(recording.provider).toBe("keytickd");
	});

	it("drops events from before the recording started", () => {
		const recording = buildKeyRecording([down(9_999), down(10_001)], 10_000, [], "keytickd");
		expect(recording.samples.map((sample) => sample.timeMs)).toEqual([1]);
	});

	it("cuts paused stretches out, as the video does", () => {
		const recording = buildKeyRecording(
			[down(11_000), down(12_500), down(14_000), down(17_500)],
			10_000,
			[
				{ startMs: 2_000, endMs: 3_000 },
				{ startMs: 6_000, endMs: 7_000 },
			],
			"keytickd",
		);
		// 2.5 s is inside the first pause; 4 s loses one second of pause, 7.5 s loses two.
		expect(recording.samples.map((sample) => sample.timeMs)).toEqual([1_000, 3_000, 5_500]);
	});

	it("keeps kind and voice, and sorts by time", () => {
		const recording = buildKeyRecording(
			[
				{ atMs: 300, type: "up", kind: "enter", voice: 9 },
				{ atMs: 200, type: "down", kind: "enter", voice: 9 },
			],
			0,
			[],
			"keytickd",
		);
		expect(recording.samples).toEqual([
			{ timeMs: 200, type: "down", kind: "enter", voice: 9 },
			{ timeMs: 300, type: "up", kind: "enter", voice: 9 },
		]);
	});
});

describe("parseKeyRecording", () => {
	it("round-trips what buildKeyRecording wrote", () => {
		const recording = buildKeyRecording([down(5, 200)], 0, [], "keytickd");
		expect(parseKeyRecording(JSON.parse(JSON.stringify(recording)))).toEqual(recording);
	});

	it("reads anything that is not a key recording as null", () => {
		expect(parseKeyRecording(null)).toBeNull();
		expect(parseKeyRecording([])).toBeNull();
		expect(parseKeyRecording({ version: 2, samples: [] })).toBeNull();
		expect(parseKeyRecording({ version: 1 })).toBeNull();
	});

	it("skips malformed samples instead of failing the whole file", () => {
		const parsed = parseKeyRecording({
			version: 1,
			provider: "keytickd",
			samples: [
				{ timeMs: 10, type: "down", kind: "key", voice: 3 },
				{ timeMs: Number.NaN, type: "down", kind: "key", voice: 3 },
				{ timeMs: 20, type: "press", kind: "key", voice: 3 },
				{ timeMs: 30, type: "down", kind: "letter-a", voice: 3 },
				{ timeMs: 40, type: "down", kind: "key", voice: 999 },
				null,
			],
		});
		expect(parsed?.samples).toEqual([{ timeMs: 10, type: "down", kind: "key", voice: 3 }]);
	});
});
