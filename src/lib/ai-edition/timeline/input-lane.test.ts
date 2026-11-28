import { describe, expect, it } from "vitest";
import { laneEventsBetween, laneEventsSpan, laneMarks, placeLaneEvents } from "./input-lane";

const event = (timeMs: number, muted = false) => ({ timeMs, muted });
const clip = (over: Record<string, number | string> = {}) => ({
	assetId: "asset_1",
	sourceStartSec: 0,
	sourceEndSec: 10,
	timelineStartSec: 0,
	timelineEndSec: 10,
	...over,
});

describe("placeLaneEvents", () => {
	it("puts an event where its clip shows it on the ruler", () => {
		// The take from 2 s to 6 s, shown from 10 s on the ruler.
		const placed = placeLaneEvents([event(1000), event(3000), event(6000)], "asset_1", [
			clip({ sourceStartSec: 2, sourceEndSec: 6, timelineStartSec: 10, timelineEndSec: 14 }),
		]);
		// 1 s is before the clip's footage, 6 s is its end (not shown): only 3 s is placed.
		expect(placed).toEqual([{ timeMs: 3000, muted: false, rulerSec: 11 }]);
	});

	it("places an event once per clip that shows it, in ruler order", () => {
		const placed = placeLaneEvents([event(1000)], "asset_1", [
			clip({ timelineStartSec: 20, timelineEndSec: 30 }),
			clip(),
			clip({ assetId: "asset_2" }),
		]);
		expect(placed.map((p) => p.rulerSec)).toEqual([1, 21]);
	});

	it("reads a clip with no stored end from its length on the ruler", () => {
		const placed = placeLaneEvents([event(4000), event(6000)], "asset_1", [
			{ assetId: "asset_1", sourceStartSec: 0, timelineStartSec: 0, timelineEndSec: 5 },
		]);
		expect(placed.map((p) => p.timeMs)).toEqual([4000]);
	});

	it("is empty with no take or no event", () => {
		expect(placeLaneEvents([event(1)], null, [clip()])).toEqual([]);
		expect(placeLaneEvents([], "asset_1", [clip()])).toEqual([]);
	});
});

describe("laneMarks", () => {
	// Typing: five presses 50 ms apart, then one a second later.
	const placed = placeLaneEvents(
		[1000, 1050, 1100, 1150, 1200, 2200].map((ms) => event(ms, ms === 1050)),
		"asset_1",
		[clip()],
	);

	it("draws one mark per press once the timeline is zoomed in far enough", () => {
		// 200 px per second: 50 ms is 10 px, wider than a 4 px mark.
		const marks = laneMarks(placed, 0, 10, 200, 4);
		expect(marks.map((mark) => mark.timesMs)).toEqual([
			[1000],
			[1050],
			[1100],
			[1150],
			[1200],
			[2200],
		]);
		expect(marks[1].sound).toBe("off");
		expect(marks[0].sound).toBe("on");
	});

	it("shares a mark between presses too close to tell apart, and says when their sounds differ", () => {
		// 10 px per second: the burst is 2 px wide.
		const marks = laneMarks(placed, 0, 10, 10, 4);
		expect(marks.map((mark) => mark.timesMs.length)).toEqual([5, 1]);
		expect(marks[0].sound).toBe("mixed");
		expect(marks[0].fromSec).toBe(1);
		expect(marks[0].toSec).toBe(1.2);
		expect(marks[0].atSec).toBeCloseTo(1.1);
	});

	it("builds only the stretch asked for", () => {
		expect(laneMarks(placed, 2, 10, 200, 4).map((mark) => mark.timesMs)).toEqual([[2200]]);
		expect(laneMarks(placed, 5, 10, 200, 4)).toEqual([]);
	});

	it("groups the same way wherever the window starts", () => {
		const whole = laneMarks(placed, 0, 10, 40, 4).map((mark) => mark.timesMs);
		const panned = laneMarks(placed, 0.9, 10, 40, 4).map((mark) => mark.timesMs);
		expect(panned).toEqual(whole);
	});

	it("draws nothing before the panel is measured", () => {
		expect(laneMarks(placed, 0, 10, 0, 4)).toEqual([]);
	});
});

describe("selecting on a lane", () => {
	const placed = placeLaneEvents([event(1000), event(2000), event(3000)], "asset_1", [
		clip(),
		clip({ timelineStartSec: 10, timelineEndSec: 20 }),
	]);

	it("names the presses between two ruler seconds, either way round, once each", () => {
		expect(laneEventsBetween(placed, 1.5, 3)).toEqual([2000, 3000]);
		expect(laneEventsBetween(placed, 3, 1.5)).toEqual([2000, 3000]);
		// Across both showings of the take: each press is still named once.
		expect(laneEventsBetween(placed, 0, 20).sort()).toEqual([1000, 2000, 3000]);
	});

	it("measures the stretch of ruler a selection covers", () => {
		expect(laneEventsSpan(placed, new Set([2000]))).toEqual({ fromSec: 2, toSec: 12 });
		expect(laneEventsSpan(placed, new Set([9999]))).toBeNull();
	});
});
