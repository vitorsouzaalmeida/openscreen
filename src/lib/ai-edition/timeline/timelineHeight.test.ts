import { describe, expect, it } from "vitest";
import {
	CLIP_ROW_GAP_PX,
	CLIP_ROW_HEIGHT_PX,
	EMPTY_TIMELINE_CONTENT_HEIGHT_PX,
	HINT_ROW_HEIGHT_PX,
	LANE_GAP_PX,
	LAYOUT_LANE_BLOCK_PX,
	REGION_LANE_HEIGHT_PX,
	TIMELINE_CHROME_HEIGHT_PX,
	timelineContentHeightPx,
} from "./timelineHeight";

const BARE = TIMELINE_CHROME_HEIGHT_PX + CLIP_ROW_HEIGHT_PX + CLIP_ROW_GAP_PX;

describe("timelineContentHeightPx", () => {
	it("is the chrome and the clip row when nothing else is drawn", () => {
		expect(timelineContentHeightPx({ laneHeights: [], layoutLane: false, hintRow: false })).toBe(
			BARE,
		);
	});

	it("adds each lane with the margin under it", () => {
		expect(
			timelineContentHeightPx({
				laneHeights: [REGION_LANE_HEIGHT_PX, 51],
				layoutLane: false,
				hintRow: false,
			}),
		).toBe(BARE + REGION_LANE_HEIGHT_PX + LANE_GAP_PX + 51 + LANE_GAP_PX);
	});

	it("adds the layout lane and the hint row only when they are drawn", () => {
		expect(timelineContentHeightPx({ laneHeights: [], layoutLane: true, hintRow: false })).toBe(
			BARE + LAYOUT_LANE_BLOCK_PX,
		);
		expect(timelineContentHeightPx({ laneHeights: [], layoutLane: false, hintRow: true })).toBe(
			BARE + HINT_ROW_HEIGHT_PX + LANE_GAP_PX,
		);
	});

	it("starts an empty project at the clip row plus the hint row", () => {
		expect(EMPTY_TIMELINE_CONTENT_HEIGHT_PX).toBe(BARE + HINT_ROW_HEIGHT_PX + LANE_GAP_PX);
	});
});
