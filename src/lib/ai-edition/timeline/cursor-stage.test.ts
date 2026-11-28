import { describe, expect, it } from "vitest";
import type { AxcutDocument } from "../schema";
import { cursorStageMapping, flatPictureDocument } from "./cursor-stage";

const FULL = { x: 0, y: 0, width: 1, height: 1 };

describe("cursorStageMapping", () => {
	it("is the identity for an upright, uncropped picture that fits its box", () => {
		const mapping = cursorStageMapping({ crop: FULL, rotation: 0, cover: null });
		expect(mapping.toStage(0.25, 0.75)).toEqual({ x: 0.25, y: 0.75 });
		expect(mapping.toFrame(0.25, 0.75)).toEqual({ cx: 0.25, cy: 0.75 });
	});

	it("places a point inside the clip's crop", () => {
		const mapping = cursorStageMapping({
			crop: { x: 0.5, y: 0, width: 0.5, height: 1 },
			rotation: 0,
			cover: null,
		});
		// The right half is shown: its left edge is the stage's left edge.
		expect(mapping.toStage(0.5, 0.5)).toEqual({ x: 0, y: 0.5 });
		expect(mapping.toStage(0.75, 0.5)).toEqual({ x: 0.5, y: 0.5 });
		// A point the crop cuts out lands outside the stage.
		expect(mapping.toStage(0.25, 0.5).x).toBeLessThan(0);
		expect(mapping.toFrame(0.5, 0.5)).toEqual({ cx: 0.75, cy: 0.5 });
	});

	it("mirrors a clip turned by a half turn", () => {
		const mapping = cursorStageMapping({ crop: FULL, rotation: 180, cover: null });
		expect(mapping.toStage(0.1, 0.2)).toEqual({ x: 0.9, y: 0.8 });
		expect(mapping.toFrame(0.9, 0.8).cx).toBeCloseTo(0.1);
		expect(mapping.toFrame(0.9, 0.8).cy).toBeCloseTo(0.2);
	});

	it("accounts for the cut a covering box makes", () => {
		// A 16:9 picture covering a square box: the middle 9/16 of its width shows.
		const mapping = cursorStageMapping({
			crop: FULL,
			rotation: 0,
			cover: { stageAspect: 1, pictureAspect: 16 / 9 },
		});
		expect(mapping.toStage(0.5, 0.5)).toEqual({ x: 0.5, y: 0.5 });
		const shown = 9 / 16;
		expect(mapping.toStage((1 - shown) / 2, 0).x).toBeCloseTo(0);
		expect(mapping.toStage(1 - (1 - shown) / 2, 1).x).toBeCloseTo(1);
		expect(mapping.toFrame(0, 0).cx).toBeCloseTo((1 - shown) / 2);
	});

	it("round-trips through crop, turn and cover together", () => {
		const mapping = cursorStageMapping({
			crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
			rotation: 180,
			cover: { stageAspect: 2, pictureAspect: 1.2 },
		});
		const staged = mapping.toStage(0.45, 0.6);
		const back = mapping.toFrame(staged.x, staged.y);
		expect(back.cx).toBeCloseTo(0.45);
		expect(back.cy).toBeCloseTo(0.6);
	});

	it("keeps a drop outside the picture on the frame", () => {
		const mapping = cursorStageMapping({ crop: FULL, rotation: 0, cover: null });
		expect(mapping.toFrame(-0.3, 1.4)).toEqual({ cx: 0, cy: 1 });
	});
});

describe("flatPictureDocument", () => {
	const document = (over: Partial<AxcutDocument>) =>
		({ zoomRanges: [], legacyEditor: null, ...over }) as AxcutDocument;

	it("hands back the very document when nothing moves the picture", () => {
		const still = document({ legacyEditor: { padding: 10 } });
		expect(flatPictureDocument(still)).toBe(still);
	});

	it("drops the zooms and the fill that pans after the pointer, and nothing else", () => {
		const moving = document({
			zoomRanges: [{ id: "zoom_1" }] as AxcutDocument["zoomRanges"],
			legacyEditor: { padding: 10, formatFollowCursor: true },
		});
		const flat = flatPictureDocument(moving);
		expect(flat.zoomRanges).toEqual([]);
		expect(flat.legacyEditor).toEqual({ padding: 10, formatFollowCursor: false });
		// The document it was made from is untouched.
		expect(moving.zoomRanges).toHaveLength(1);
	});
});
