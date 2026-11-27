// What `npm run i18n:check` cannot see in a tooltip string: it only checks that a key exists.
// A tooltip is capped at 260px wide and reads best in at most four lines, so its length is
// held here. Add a key when a tooltip (or the accessible name of an icon-only control) gets one.
//
// See technical-documentation/engineering/tooltips.md.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CATALOG_DIR = resolve(process.cwd(), "src/i18n/locales/en");
const MAX_LENGTH = 130;

const TOOLTIP_KEYS: Record<string, string[]> = {
	launch: [
		"tooltips.hideHUD",
		"tooltips.hideHUDTip",
		"tooltips.closeApp",
		"tooltips.restartRecording",
		"tooltips.cancelRecording",
		"tooltips.pauseRecording",
		"tooltips.resumeRecording",
		"tooltips.useVerticalTray",
		"tooltips.useHorizontalTray",
		"tooltips.changeSource",
		"tooltips.systemAudio",
		"tooltips.microphone",
		"tooltips.camera",
		"tooltips.openStudio",
		"tooltips.openNotes",
		"cursor.name",
		"cursor.editableTip",
		"cursor.systemTip",
		"recording.selectSource",
		"recording.systemPicker",
		"recording.start",
		"recording.stop",
		"deviceSettings.title",
		"deviceSettings.close",
	],
	timeline: [
		"trails.zoomIn",
		"trails.zoomOut",
		"trails.zoomInCut",
		"trails.zoomOutCut",
		"trails.pan",
	],
};

function read(namespace: string, key: string): string {
	const file = JSON.parse(readFileSync(`${CATALOG_DIR}/${namespace}.json`, "utf8"));
	const value = key.split(".").reduce((node, part) => node?.[part], file);
	if (typeof value !== "string") throw new Error(`${namespace}: ${key} is not a string`);
	return value;
}

const tooLong = (entries: readonly (readonly [string, string])[]) =>
	entries
		.map(([namespace, key]) => [`${namespace}.${key}`, read(namespace, key).length] as const)
		.filter(([, length]) => length > MAX_LENGTH)
		.map(([name, length]) => `${name} (${length})`);
const entries = Object.entries(TOOLTIP_KEYS).flatMap(([namespace, keys]) =>
	keys.map((key) => [namespace, key] as const),
);

describe("tooltip strings", () => {
	it("stay short", () => {
		expect(tooLong(entries)).toEqual([]);
	});
});

// The long tail: the tips on the inspector switches and the Notes mirror button, and the
// tooltips reworded with them (the roundness range, the transcript word chips, the camera
// preview's name). A list of its own, so it changes apart from the one above.
const LONG_TAIL_KEYS: Record<string, string[]> = {
	settings: [
		"effects.depthOfFieldTip",
		"effects.roundnessFrameHelp",
		"cursor.autoHideTip",
		"cursor.model3dTip",
		"cursor.clickImpactTip",
		"layout.reactiveWebcamTip",
		"transcript.insertedWord",
		"transcript.correctedWord",
	],
	launch: ["tooltips.notesToolbar.mirrorTip"],
	editor: ["preview.webcamPreview", "editClipDialog.rotationTip"],
};
const longTailEntries = Object.entries(LONG_TAIL_KEYS).flatMap(([namespace, keys]) =>
	keys.map((key) => [namespace, key] as const),
);

describe("long-tail tooltip strings", () => {
	it("stay short", () => {
		expect(tooLong(longTailEntries)).toEqual([]);
	});
});

// The editor's own block: the timeline toolbar and transport, the top bar, the inspector rail,
// and Record mode. Kept apart from the list above so the two grow independently.
const EDITOR_TOOLTIP_KEYS: Record<string, string[]> = {
	timeline: [
		"buttons.addZoom",
		"buttons.addTrim",
		"buttons.addSpeed",
		"buttons.addAnnotation",
		"buttons.addCameraFullscreen",
		"buttons.autoFocusAll",
		"buttons.autoFocusAllTip",
		"buttons.clearTimeline",
		"toolbar.dragToReorderHint",
		"toolbar.editInOutPoints",
		"toolbar.deleteClip",
		"labels.panTip",
		"labels.zoomTip",
	],
	editor: [
		"transport.play",
		"transport.pause",
		"inspector.editClipTip",
		"rec.systemAudioTip",
		"rec.editableCursor",
		"rec.editableCursorTip",
		"rec.hideDesktopIconsHintMac",
		"rec.hideDesktopIconsHintWindows",
		"mediaStage.regenerate",
		"mediaStage.regenerateTip",
		"mediaStage.cpuBackendHint",
	],
	settings: [
		"facets.tips.effects",
		"facets.tips.layout",
		"facets.tips.audio",
		"facets.tips.cursor",
		"facets.tips.transcript",
		"audioTrack.slipHint",
	],
	shortcuts: ["fixedActions.undo", "fixedActions.redo"],
};
// Tooltips that end in a chip built from the user's live binding (formatBinding). A key written
// into the string would lie after a remap.
const CHIP_KEYS: Record<string, string[]> = {
	timeline: [
		"buttons.addZoom",
		"buttons.addTrim",
		"buttons.addSpeed",
		"buttons.addAnnotation",
		"buttons.addCameraFullscreen",
	],
	editor: ["transport.play", "transport.pause"],
};
const editorEntries = Object.entries(EDITOR_TOOLTIP_KEYS).flatMap(([namespace, keys]) =>
	keys.map((key) => [namespace, key] as const),
);
const chipEntries = Object.entries(CHIP_KEYS).flatMap(([namespace, keys]) =>
	keys.map((key) => [namespace, key] as const),
);

describe("editor tooltip strings", () => {
	it("stay short", () => {
		expect(tooLong(editorEntries)).toEqual([]);
	});

	it("write no key into a tooltip that shows a shortcut chip", () => {
		const bakedIn = chipEntries
			.map(([namespace, key]) => [`${namespace}.${key}`, read(namespace, key)] as const)
			// "(Z)", "(Space)" and the like.
			.filter(([, text]) => /\(\s*(?:[A-Z]|Space|Enter|Ctrl[^)]*)\s*\)/.test(text));
		expect(bakedIn).toEqual([]);
	});

	// One term per concept: the HUD's toggle and this row are the same setting.
	it("call the Record mode cursor row what the HUD calls it", () => {
		expect(read("editor", "rec.editableCursor")).toBe(read("launch", "cursor.name"));
	});

	// Clear timeline has no confirmation, so its tooltip is where the loss is said: what goes
	// (Full Camera included) and what stays.
	it("says what Clear timeline removes and what it keeps", () => {
		const text = read("timeline", "buttons.clearTimeline");
		for (const goes of ["zooms", "trims", "speeds", "annotations", "Full Camera"]) {
			expect(text).toContain(goes);
		}
		expect(text).toContain("Clips, audio and captions stay");
	});

	it("do not call the moving line on the timeline the playhead", () => {
		// The strings say "current time".
		const uses = editorEntries
			.map(([namespace, key]) => [`${namespace}.${key}`, read(namespace, key)] as const)
			.filter(([, text]) => /playhead/i.test(text));
		expect(uses).toEqual([]);
	});
});
