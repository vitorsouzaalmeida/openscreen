// The height the timeline panel needs to show everything it holds.
//
// A lane exists only while it has content, so the panel follows the project: a take with
// nothing but zooms is short, one with annotations, music and a voiceover is tall. The
// timeline (V4Timeline) knows which lanes it draws, drag previews included, so it reports
// this number and the shell sizes the panel from it, plus whatever the user dragged the
// panel's edge by.
//
// The constants mirror the timeline's CSS (EditorShellV4.module.css). The row heights that
// can drift are also set inline from here, so there is one source for them.

/** Toolbar (48), ruler row (48), the tracks' bottom padding (8) and the pan/zoom bar's band (28). */
export const TIMELINE_CHROME_HEIGHT_PX = 132;
/** The clip row, the first row under the ruler. */
export const CLIP_ROW_HEIGHT_PX = 66;
/** The gap between the clip row and the first lane under it. */
export const CLIP_ROW_GAP_PX = 6;
/** The margin under every lane. */
export const LANE_GAP_PX = 5;
/** A lane whose pills never stack (zoom, trim, speed, effect): tall enough for a pill that
 *  shows its kind above its value. */
export const REGION_LANE_HEIGHT_PX = 40;
/** The Clicks and Keys lanes: a row of marks, with nothing to read inside them. */
export const INPUT_LANE_HEIGHT_PX = 18;
/** The camera-layout lane with its own margins (Layouts.module.css `.lane`). */
export const LAYOUT_LANE_BLOCK_PX = 40;
/** The one row that names the keys for the kinds the project has none of yet. */
export const HINT_ROW_HEIGHT_PX = 28;

export interface TimelineContent {
	/** Heights of the lanes drawn under the clip row, top to bottom, without their margins. */
	laneHeights: readonly number[];
	/** Whether the camera-layout lane is drawn. */
	layoutLane: boolean;
	/** Whether the key-hint row is drawn. */
	hintRow: boolean;
}

export function timelineContentHeightPx({
	laneHeights,
	layoutLane,
	hintRow,
}: TimelineContent): number {
	const lanes = laneHeights.reduce((sum, height) => sum + height + LANE_GAP_PX, 0);
	return (
		TIMELINE_CHROME_HEIGHT_PX +
		CLIP_ROW_HEIGHT_PX +
		CLIP_ROW_GAP_PX +
		lanes +
		(layoutLane ? LAYOUT_LANE_BLOCK_PX : 0) +
		(hintRow ? HINT_ROW_HEIGHT_PX + LANE_GAP_PX : 0)
	);
}

/** A project with a clip and nothing else: the clip row and the hint row. */
export const EMPTY_TIMELINE_CONTENT_HEIGHT_PX = timelineContentHeightPx({
	laneHeights: [],
	layoutLane: false,
	hintRow: true,
});
