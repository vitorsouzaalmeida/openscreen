// Where a recorded pointer position falls on the preview's screen stage, and back.
//
// A pointer position is stored as fractions of the RECORDED frame. The stage the editor's
// handles sit on (`.screenStage`, PreviewCanvas) shows that frame after three things the
// compositor does to it, in this order: the clip's half turn, its crop, and, where the layout
// makes the picture cover its box, the centred cut that fills the box. The path overlay goes
// through here both ways, so a point is drawn on the pixel the compositor draws the pointer on,
// and a drag puts it where the user dropped it.
//
// Zooms and the cursor-following fill are not here: the preview shows the picture flat while a
// cursor override is being edited (see `flatPictureDocument`), so there is nothing to undo.
//
// Pure: no DOM.

import type { AxcutDocument } from "../schema";

export interface CursorStageMapping {
	/** Frame fractions to stage fractions. Not clamped: a point the crop cuts out lands outside 0..1. */
	toStage(cx: number, cy: number): { x: number; y: number };
	/** Stage fractions to frame fractions, clamped to the frame. */
	toFrame(x: number, y: number): { cx: number; cy: number };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function cursorStageMapping(input: {
	/** The clip's crop, in fractions of the (turned) frame. */
	crop: { x: number; y: number; width: number; height: number };
	/** The clip's half turn. */
	rotation: 0 | 180;
	/**
	 * Set when the picture covers its box instead of fitting it: the box's proportions and the
	 * cropped picture's, width over height. Null when the box was sized to the picture.
	 */
	cover: { stageAspect: number; pictureAspect: number } | null;
}): CursorStageMapping {
	const { crop, rotation, cover } = input;
	// The part of the cropped picture a covering box shows, centred, as fractions of it.
	let shownWidth = 1;
	let shownHeight = 1;
	if (cover && cover.stageAspect > 0 && cover.pictureAspect > 0) {
		if (cover.stageAspect > cover.pictureAspect) {
			shownHeight = cover.pictureAspect / cover.stageAspect;
		} else {
			shownWidth = cover.stageAspect / cover.pictureAspect;
		}
	}
	const cropWidth = Math.max(1e-6, crop.width);
	const cropHeight = Math.max(1e-6, crop.height);
	return {
		toStage(cx, cy) {
			const turnedX = rotation === 180 ? 1 - cx : cx;
			const turnedY = rotation === 180 ? 1 - cy : cy;
			const pictureX = (turnedX - crop.x) / cropWidth;
			const pictureY = (turnedY - crop.y) / cropHeight;
			return {
				x: (pictureX - (1 - shownWidth) / 2) / shownWidth,
				y: (pictureY - (1 - shownHeight) / 2) / shownHeight,
			};
		},
		toFrame(x, y) {
			const pictureX = x * shownWidth + (1 - shownWidth) / 2;
			const pictureY = y * shownHeight + (1 - shownHeight) / 2;
			const turnedX = clamp01(crop.x + pictureX * cropWidth);
			const turnedY = clamp01(crop.y + pictureY * cropHeight);
			return {
				cx: rotation === 180 ? 1 - turnedX : turnedX,
				cy: rotation === 180 ? 1 - turnedY : turnedY,
			};
		},
	};
}

/**
 * The document as the preview shows it while a cursor override is being edited: no zoom, and no
 * fill that pans after the pointer. Both move the picture under the stage from frame to frame,
 * so a point drawn on the stage would not sit on the pixel it names. Everything else (layout,
 * padding, crop, the pointer itself) is as the export will have it.
 */
export function flatPictureDocument(document: AxcutDocument): AxcutDocument {
	const follows =
		(document.legacyEditor as Record<string, unknown> | null)?.formatFollowCursor === true;
	if (document.zoomRanges.length === 0 && !follows) return document;
	return {
		...document,
		zoomRanges: [],
		legacyEditor: follows
			? { ...document.legacyEditor, formatFollowCursor: false }
			: document.legacyEditor,
	};
}
