import { describe, expect, it } from "vitest";
import type { AxcutCursorOverride } from "../schema";
import {
	applyCursorOverrides,
	CURSOR_GLIDE_MS,
	clampCursorOverrideSpan,
	createCursorOverride,
	cursorOverrideRulerSpans,
	cursorOverrideSamples,
	cursorOverridesForAsset,
	cursorPatchesForScene,
	cursorPositionAt,
	mapCursorOverride,
	patchCursorOverridePoint,
	withCursorOverridePoint,
	withCursorOverrideSpan,
	withCursorOverrides,
	withoutCursorOverridePoint,
} from "./cursor-overrides";

const override = (over: Partial<AxcutCursorOverride> = {}): AxcutCursorOverride => ({
	id: "cursor_1",
	assetId: "asset_1",
	sourceStartMs: 10_000,
	sourceEndMs: 14_000,
	points: [],
	origin: "user",
	...over,
});

const at = (samples: Array<{ timeMs: number; cx: number; cy: number }>, timeMs: number) =>
	cursorPositionAt(samples, timeMs);

describe("cursorOverrideSamples", () => {
	it("rests on the first point, then arrives on the next one at that point's time", () => {
		const samples = cursorOverrideSamples(
			override({
				points: [
					{ timeMs: 10_000, cx: 0.2, cy: 0.2 },
					{ timeMs: 13_000, cx: 0.8, cy: 0.6 },
				],
			}),
		);
		// At rest until the glide starts, one glide's length before the arrival.
		expect(at(samples, 11_000)).toEqual({ cx: 0.2, cy: 0.2 });
		expect(at(samples, 13_000 - CURSOR_GLIDE_MS)).toEqual({ cx: 0.2, cy: 0.2 });
		// Halfway through an eased glide is halfway there.
		const mid = at(samples, 13_000 - CURSOR_GLIDE_MS / 2);
		expect(mid?.cx).toBeCloseTo(0.5, 1);
		expect(at(samples, 13_000)).toEqual({ cx: 0.8, cy: 0.6 });
		// And it stays there to the end of the span.
		expect(at(samples, 14_000)).toEqual({ cx: 0.8, cy: 0.6 });
		expect(samples[0].timeMs).toBe(10_000);
		expect(samples[samples.length - 1].timeMs).toBe(14_000);
	});

	it("glides the whole way when two points are closer than a glide", () => {
		const samples = cursorOverrideSamples(
			override({
				points: [
					{ timeMs: 10_000, cx: 0, cy: 0 },
					{ timeMs: 10_300, cx: 1, cy: 1 },
				],
			}),
		);
		const mid = at(samples, 10_150);
		expect(mid?.cx).toBeGreaterThan(0.3);
		expect(mid?.cx).toBeLessThan(0.7);
	});

	it("holds the first point from the start of the span", () => {
		const samples = cursorOverrideSamples(
			override({ points: [{ timeMs: 12_000, cx: 0.4, cy: 0.9 }] }),
		);
		expect(samples[0]).toMatchObject({ timeMs: 10_000, cx: 0.4, cy: 0.9 });
		expect(at(samples, 11_000)).toEqual({ cx: 0.4, cy: 0.9 });
	});

	it("presses on a clicked point and releases shortly after", () => {
		const samples = cursorOverrideSamples(
			override({ points: [{ timeMs: 12_000, cx: 0.5, cy: 0.5, click: true }] }),
		);
		expect(
			samples.filter((s) => s.interactionType !== "move").map((s) => [s.timeMs, s.interactionType]),
		).toEqual([
			[12_000, "click"],
			[12_080, "mouseup"],
		]);
	});

	it("keeps a click that lands on the last millisecond of the span", () => {
		const samples = cursorOverrideSamples(
			override({ points: [{ timeMs: 14_000, cx: 0.5, cy: 0.5, click: true }] }),
		);
		expect(samples[samples.length - 1]).toMatchObject({ timeMs: 14_000, interactionType: "click" });
	});

	it("never emits two samples for one millisecond, and stays in order", () => {
		const samples = cursorOverrideSamples(
			override({
				points: [
					{ timeMs: 10_000, cx: 0.1, cy: 0.1, click: true },
					{ timeMs: 10_000, cx: 0.9, cy: 0.9 },
					{ timeMs: 10_040, cx: 0.5, cy: 0.5, click: true },
					{ timeMs: 14_000, cx: 0.2, cy: 0.2 },
				],
			}),
		);
		const times = samples.map((s) => s.timeMs);
		expect(times).toEqual([...times].sort((a, b) => a - b));
		expect(new Set(times).size).toBe(times.length);
	});

	it("reports a resting pointer sparsely, and a glide at the recorder's rate", () => {
		const samples = cursorOverrideSamples(
			override({
				sourceStartMs: 0,
				sourceEndMs: 600_000,
				points: [{ timeMs: 0, cx: 0.5, cy: 0.5 }],
			}),
		);
		// Ten minutes at rest: a sample every half second, not every frame.
		expect(samples.length).toBeLessThan(1300);
		expect(samples.length).toBeGreaterThan(1100);
	});

	it("marks every sample hidden when the override hides the pointer", () => {
		const samples = cursorOverrideSamples(
			override({ hidden: true, points: [{ timeMs: 11_000, cx: 0.3, cy: 0.3 }] }),
		);
		expect(samples.every((s) => s.visible === false)).toBe(true);
	});

	it("draws nothing without a point, so readers interpolate across the span", () => {
		expect(cursorOverrideSamples(override())).toEqual([]);
	});

	it("still carries the hidden state when it has no point to stand on", () => {
		const samples = cursorOverrideSamples(override({ hidden: true }));
		expect(samples.map((s) => [s.timeMs, s.visible])).toEqual([
			[10_000, false],
			[14_000, false],
		]);
	});

	it("holds a point stored outside the span on the nearest edge", () => {
		const samples = cursorOverrideSamples(
			override({ points: [{ timeMs: 99_000, cx: 0.7, cy: 0.7 }] }),
		);
		expect(samples[samples.length - 1]).toMatchObject({ timeMs: 14_000, cx: 0.7, cy: 0.7 });
	});
});

describe("applyCursorOverrides", () => {
	const recorded = [0, 5_000, 10_000, 12_000, 14_000, 20_000].map((timeMs) => ({
		timeMs,
		cx: timeMs / 20_000,
		cy: 0,
		interactionType: timeMs === 12_000 ? ("click" as const) : ("move" as const),
	}));

	it("hands the recording back untouched when there is no override", () => {
		expect(applyCursorOverrides(recorded, [])).toBe(recorded);
	});

	it("cuts the span out, ends included, and puts the override's samples in", () => {
		const drawn = applyCursorOverrides(recorded, [
			override({ points: [{ timeMs: 11_000, cx: 0.9, cy: 0.9 }] }),
		]);
		// The recorded click at 12 s is inside the span: it is gone.
		expect(drawn.some((s) => s.interactionType === "click")).toBe(false);
		expect(drawn.filter((s) => s.timeMs < 10_000).map((s) => s.timeMs)).toEqual([0, 5_000]);
		expect(drawn.filter((s) => s.timeMs > 14_000).map((s) => s.timeMs)).toEqual([20_000]);
		expect(at(drawn, 12_000)).toEqual({ cx: 0.9, cy: 0.9 });
		const times = drawn.map((s) => s.timeMs);
		expect(times).toEqual([...times].sort((a, b) => a - b));
	});

	it("interpolates straight across an override that has no point", () => {
		const drawn = applyCursorOverrides(recorded, [override()]);
		expect(drawn.map((s) => s.timeMs)).toEqual([0, 5_000, 20_000]);
		// Halfway between the last sample before (5 s) and the first after (20 s).
		expect(at(drawn, 12_500)?.cx).toBeCloseTo((0.25 + 1) / 2);
	});

	it("gives a take that recorded no pointer the overrides alone", () => {
		const drawn = applyCursorOverrides(
			[],
			[override({ points: [{ timeMs: 10_500, cx: 0.4, cy: 0.4, click: true }] })],
		);
		expect(drawn.length).toBeGreaterThan(0);
		expect(drawn.some((s) => s.interactionType === "click")).toBe(true);
	});
});

describe("overrides in the document", () => {
	const document = {
		cursorOverrides: [
			override({ id: "b", sourceStartMs: 20_000, sourceEndMs: 21_000 }),
			override({ id: "other", assetId: "asset_2" }),
			override({ id: "a" }),
		],
	};

	it("lists one asset's overrides in time order", () => {
		expect(cursorOverridesForAsset(document, "asset_1").map((o) => o.id)).toEqual(["a", "b"]);
		expect(cursorOverridesForAsset(document, null)).toEqual([]);
		expect(cursorOverridesForAsset({}, "asset_1")).toEqual([]);
	});

	it("names each patch by its asset's file and skips an asset with none", () => {
		const patches = cursorPatchesForScene(
			document,
			new Map([["asset_1", { originalPath: "/takes/a.mp4" }]]),
		);
		expect(patches.map((p) => [p.screenPath, p.startMs, p.endMs])).toEqual([
			["/takes/a.mp4", 10_000, 14_000],
			["/takes/a.mp4", 20_000, 21_000],
		]);
	});

	it("replaces, removes and leaves no empty list behind", () => {
		const hidden = mapCursorOverride(document, "a", (o) => ({ ...o, hidden: true }));
		expect(hidden.cursorOverrides?.find((o) => o.id === "a")?.hidden).toBe(true);
		const removed = mapCursorOverride(document, "a", () => null);
		expect(removed.cursorOverrides?.map((o) => o.id)).toEqual(["b", "other"]);
		expect("cursorOverrides" in withCursorOverrides(document, [])).toBe(false);
	});
});

describe("editing an override", () => {
	// The recorded pointer walks left to right, one tenth of the frame per second.
	const recordedAt = (timeMs: number) => ({ cx: timeMs / 100_000, cy: 0.5 });

	it("opens and closes on the recorded pointer", () => {
		const created = createCursorOverride({
			id: "cursor_1",
			assetId: "asset_1",
			startMs: 10_000,
			endMs: 14_000,
			recordedAt,
		});
		expect(created.points).toEqual([
			{ timeMs: 10_000, cx: 0.1, cy: 0.5, recorded: true },
			{ timeMs: 14_000, cx: 0.14, cy: 0.5, recorded: true },
		]);
	});

	it("has no point to open on when the take recorded no pointer", () => {
		const created = createCursorOverride({
			id: "cursor_1",
			assetId: "asset_1",
			startMs: 0,
			endMs: 1000,
			recordedAt: () => null,
		});
		expect(created.points).toEqual([]);
	});

	it("reads its joins again where a resized edge lands, and keeps the user's points", () => {
		const base = override({
			points: [
				{ timeMs: 10_000, cx: 0.1, cy: 0.5, recorded: true },
				{ timeMs: 12_000, cx: 0.9, cy: 0.9 },
				{ timeMs: 14_000, cx: 0.14, cy: 0.5, recorded: true },
			],
		});
		const grown = withCursorOverrideSpan(base, 10_000, 16_000, recordedAt);
		expect(grown.points).toEqual([
			{ timeMs: 10_000, cx: 0.1, cy: 0.5, recorded: true },
			{ timeMs: 12_000, cx: 0.9, cy: 0.9 },
			{ timeMs: 16_000, cx: 0.16, cy: 0.5, recorded: true },
		]);
		// Shrunk past the user's point: that stretch is gone, and the point with it.
		const shrunk = withCursorOverrideSpan(base, 10_000, 11_000, recordedAt);
		expect(shrunk.points.map((p) => p.timeMs)).toEqual([10_000, 11_000]);
	});

	it("carries the user's points along when the whole span moves", () => {
		const base = override({
			points: [
				{ timeMs: 10_000, cx: 0.1, cy: 0.5, recorded: true },
				{ timeMs: 12_000, cx: 0.9, cy: 0.9, click: true },
				{ timeMs: 14_000, cx: 0.14, cy: 0.5, recorded: true },
			],
		});
		const moved = withCursorOverrideSpan(base, 20_000, 24_000, recordedAt, true);
		expect(moved.points).toEqual([
			{ timeMs: 20_000, cx: 0.2, cy: 0.5, recorded: true },
			{ timeMs: 22_000, cx: 0.9, cy: 0.9, click: true },
			{ timeMs: 24_000, cx: 0.24, cy: 0.5, recorded: true },
		]);
	});

	it("adds a point in time order, and moves the one already there", () => {
		const base = override({ points: [{ timeMs: 13_000, cx: 0.5, cy: 0.5, click: true }] });
		const added = withCursorOverridePoint(base, 11_000, { cx: 0.2, cy: 0.3 });
		expect(added?.points.map((p) => p.timeMs)).toEqual([11_000, 13_000]);
		// A click a few milliseconds off an existing point means that point.
		const nudged = withCursorOverridePoint(base, 13_020, { cx: 0.7, cy: 0.7 });
		expect(nudged?.points).toEqual([{ timeMs: 13_000, cx: 0.7, cy: 0.7, click: true }]);
		expect(withCursorOverridePoint(base, 99_000, { cx: 0, cy: 0 })).toBeNull();
	});

	it("makes a join the user's own point once they move it", () => {
		const base = override({
			points: [{ timeMs: 10_000, cx: 0.1, cy: 0.5, recorded: true }],
		});
		const moved = patchCursorOverridePoint(base, 0, { cx: 0.6, cy: 0.6 });
		expect(moved.points[0]).toEqual({ timeMs: 10_000, cx: 0.6, cy: 0.6 });
	});

	it("holds a retimed point between its neighbours", () => {
		const base = override({
			points: [
				{ timeMs: 10_500, cx: 0, cy: 0 },
				{ timeMs: 12_000, cx: 0.5, cy: 0.5 },
				{ timeMs: 13_000, cx: 1, cy: 1 },
			],
		});
		expect(patchCursorOverridePoint(base, 1, { timeMs: 99_000 }).points[1].timeMs).toBe(13_000);
		expect(patchCursorOverridePoint(base, 1, { timeMs: 0 }).points[1].timeMs).toBe(10_500);
		expect(patchCursorOverridePoint(base, 0, { timeMs: 0 }).points[0].timeMs).toBe(10_000);
	});

	it("sets and clears a click, and removes a point", () => {
		const base = override({ points: [{ timeMs: 11_000, cx: 0.5, cy: 0.5 }] });
		const clicked = patchCursorOverridePoint(base, 0, { click: true });
		expect(clicked.points[0].click).toBe(true);
		expect("click" in patchCursorOverridePoint(clicked, 0, { click: false }).points[0]).toBe(false);
		expect(withoutCursorOverridePoint(base, 0).points).toEqual([]);
	});
});

describe("clampCursorOverrideSpan", () => {
	const others = [override({ id: "wall", sourceStartMs: 20_000, sourceEndMs: 22_000 })];
	const limits = { minMs: 0, maxMs: 60_000 };

	it("stops a moved override flush against its neighbour, at its own length", () => {
		expect(
			clampCursorOverrideSpan(
				others,
				"cursor_1",
				"asset_1",
				{ startMs: 17_000, endMs: 21_000 },
				{ startMs: 10_000, endMs: 14_000 },
				limits,
			),
		).toEqual({ startMs: 16_000, endMs: 20_000 });
	});

	it("keeps a moved override's length against the end of the footage", () => {
		expect(
			clampCursorOverrideSpan(
				[],
				"cursor_1",
				"asset_1",
				{ startMs: 58_000, endMs: 62_000 },
				{ startMs: 10_000, endMs: 14_000 },
				limits,
			),
		).toEqual({ startMs: 56_000, endMs: 60_000 });
	});

	it("ignores another asset's overrides and its own", () => {
		const desired = { startMs: 19_000, endMs: 23_000 };
		expect(clampCursorOverrideSpan(others, "wall", "asset_1", desired, desired, limits)).toEqual(
			desired,
		);
		expect(
			clampCursorOverrideSpan(others, "cursor_1", "asset_2", desired, desired, limits),
		).toEqual(desired);
	});
});

describe("cursorOverrideRulerSpans", () => {
	it("places the override under every clip that shows its footage", () => {
		const clips = [
			// The take from 8 s to 12 s, at the head of the ruler.
			{
				id: "c1",
				assetId: "asset_1",
				sourceStartSec: 8,
				sourceEndSec: 12,
				timelineStartSec: 0,
				timelineEndSec: 4,
			},
			{
				id: "c2",
				assetId: "asset_2",
				sourceStartSec: 0,
				sourceEndSec: 5,
				timelineStartSec: 4,
				timelineEndSec: 9,
			},
			// The same take again, from 13 s.
			{
				id: "c3",
				assetId: "asset_1",
				sourceStartSec: 13,
				sourceEndSec: 20,
				timelineStartSec: 9,
				timelineEndSec: 16,
			},
		];
		expect(cursorOverrideRulerSpans(override(), clips)).toEqual([
			{ clipId: "c1", startSec: 2, endSec: 4 },
			{ clipId: "c3", startSec: 9, endSec: 10 },
		]);
	});

	it("is nowhere when no clip shows it", () => {
		expect(
			cursorOverrideRulerSpans(override(), [
				{
					id: "c1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: 5,
					timelineStartSec: 0,
					timelineEndSec: 5,
				},
			]),
		).toEqual([]);
	});
});
