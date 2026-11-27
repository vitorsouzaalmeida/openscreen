// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/ShortcutsContext", async () => {
	const { DEFAULT_SHORTCUTS } = await import("@/lib/shortcuts");
	return {
		useShortcuts: () => ({
			shortcuts: DEFAULT_SHORTCUTS,
			isMac: false,
			isConfigOpen: false,
			openConfig: vi.fn(),
			closeConfig: vi.fn(),
			setShortcuts: vi.fn(),
			persistShortcuts: () => Promise.resolve(true),
		}),
	};
});

vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: () => (key: string) => key,
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import {
	AUDIO_LANE_PAD_PX,
	AUDIO_ROW_EXPANSION_PX,
	AUDIO_ROW_HEIGHT_PX,
} from "@/lib/ai-edition/document/audioTracks";
import {
	annotationRegionSchema,
	createAudioTrack,
	createEmptyDocument,
} from "@/lib/ai-edition/schema";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { regionLaneHeight } from "@/lib/ai-edition/timeline/regionTracks";
import {
	EMPTY_TIMELINE_CONTENT_HEIGHT_PX,
	timelineContentHeightPx,
} from "@/lib/ai-edition/timeline/timelineHeight";
import {
	MAX_TIMELINE_HEIGHT_PX,
	MIN_TIMELINE_HEIGHT_PX,
	NewEditorShell,
	TIMELINE_HEIGHT_OFFSET_KEY,
} from "./NewEditorShell";

/** The panel height for a project whose only lanes under the clip row are these. Every
 *  fixture here leaves some kind missing, so the hint row is always drawn. */
const withLanes = (...laneHeights: number[]) =>
	timelineContentHeightPx({ laneHeights, layoutLane: false, hintRow: true });
const ONE_AUDIO_ROW_PX = AUDIO_ROW_HEIGHT_PX + AUDIO_LANE_PAD_PX * 2;
const rows = (heightPx: number) => `58px 1fr ${heightPx}px`;

function renderShell() {
	return render(
		<TooltipProvider>
			<NewEditorShell />
		</TooltipProvider>,
	);
}

describe("NewEditorShell timeline height", () => {
	beforeEach(() => {
		localStorage.clear();
		(window as unknown as { electronAPI?: unknown }).electronAPI = {
			setHasUnsavedChanges: () => {
				/* noop */
			},
			onRequestCloseConfirm: () => () => {
				/* unsubscribe */
			},
			onRequestSaveBeforeClose: () => () => {
				/* unsubscribe */
			},
			sendCloseConfirmResponse: () => {
				/* noop */
			},
			findRecordingCamera: () => Promise.resolve(null),
			preparePreviewAudioTrack: () => Promise.resolve(null),
			isAppPackaged: () => false,
		};
		Element.prototype.scrollTo = () => {
			/* no scrolling in jsdom */
		};
		(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = class {
			observe() {
				/* noop */
			}
			unobserve() {
				/* noop */
			}
			disconnect() {
				/* noop */
			}
		};
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
	});

	it("keeps the panel between its two clamps", () => {
		expect(MIN_TIMELINE_HEIGHT_PX).toBe(160);
		expect(MAX_TIMELINE_HEIGHT_PX).toBe(560);
	});

	it("opens an empty project at the clip row plus the hint row", () => {
		const { container } = renderShell();
		const root = container.firstElementChild as HTMLElement;
		expect(root).not.toBeNull();
		expect(root.style.gridTemplateRows).toBe(rows(EMPTY_TIMELINE_CONTENT_HEIGHT_PX));
	});

	// That height was tuned to five always-drawn lanes: read back, it would open every
	// project far taller than what it holds.
	it("does not read the height an earlier version stored", () => {
		localStorage.setItem("os-editor-timeline-height", "450");
		const { container } = renderShell();
		const root = container.firstElementChild as HTMLElement;
		expect(root.style.gridTemplateRows).toBe(rows(EMPTY_TIMELINE_CONTENT_HEIGHT_PX));
	});

	it("adds the stored offset to what the content asks for, and ignores one that is not a number", () => {
		localStorage.setItem(TIMELINE_HEIGHT_OFFSET_KEY, "40");
		const { container: c1 } = renderShell();
		expect((c1.firstElementChild as HTMLElement).style.gridTemplateRows).toBe(
			rows(EMPTY_TIMELINE_CONTENT_HEIGHT_PX + 40),
		);

		cleanup();
		localStorage.setItem(TIMELINE_HEIGHT_OFFSET_KEY, "tall");
		const { container: c2 } = renderShell();
		expect((c2.firstElementChild as HTMLElement).style.gridTemplateRows).toBe(
			rows(EMPTY_TIMELINE_CONTENT_HEIGHT_PX),
		);
	});

	it("clamps an offset that would take the panel past either bound", () => {
		localStorage.setItem(TIMELINE_HEIGHT_OFFSET_KEY, "-500");
		const { container: c1 } = renderShell();
		expect((c1.firstElementChild as HTMLElement).style.gridTemplateRows).toBe(
			rows(MIN_TIMELINE_HEIGHT_PX),
		);

		cleanup();
		localStorage.setItem(TIMELINE_HEIGHT_OFFSET_KEY, "999");
		const { container: c2 } = renderShell();
		expect((c2.firstElementChild as HTMLElement).style.gridTemplateRows).toBe(
			rows(MAX_TIMELINE_HEIGHT_PX),
		);
	});

	it("clamps pointer resizing to MIN and MAX and stores how far the panel moved", () => {
		const { container } = renderShell();
		const root = container.firstElementChild as HTMLElement;
		const handle = container.querySelector(
			'[role="separator"][aria-orientation="horizontal"]',
		) as HTMLElement;
		expect(handle).not.toBeNull();

		// Drag down significantly (clientY increases): clamps to MIN_TIMELINE_HEIGHT_PX.
		act(() => {
			fireEvent.pointerDown(handle, { clientY: 400 });
			fireEvent.pointerMove(window, { clientY: 1000 });
		});
		expect(root.style.gridTemplateRows).toBe(rows(MIN_TIMELINE_HEIGHT_PX));
		act(() => {
			fireEvent.pointerUp(window);
		});
		expect(localStorage.getItem(TIMELINE_HEIGHT_OFFSET_KEY)).toBe(
			String(MIN_TIMELINE_HEIGHT_PX - EMPTY_TIMELINE_CONTENT_HEIGHT_PX),
		);

		// Drag up significantly (clientY decreases): clamps to MAX_TIMELINE_HEIGHT_PX.
		act(() => {
			fireEvent.pointerDown(handle, { clientY: 400 });
			fireEvent.pointerMove(window, { clientY: -500 });
		});
		expect(root.style.gridTemplateRows).toBe(rows(MAX_TIMELINE_HEIGHT_PX));
		act(() => {
			fireEvent.pointerUp(window);
		});
		expect(localStorage.getItem(TIMELINE_HEIGHT_OFFSET_KEY)).toBe(
			String(MAX_TIMELINE_HEIGHT_PX - EMPTY_TIMELINE_CONTENT_HEIGHT_PX),
		);
	});

	it("grows by a lane for the first audio track, by a row for one that overlaps it, and shrinks back", () => {
		const { container } = renderShell();
		const root = container.firstElementChild as HTMLElement;
		expect(root.style.gridTemplateRows).toBe(rows(EMPTY_TIMELINE_CONTENT_HEIGHT_PX));

		const doc = createEmptyDocument({ projectId: "p", title: "t" });
		doc.audioTracks = [
			createAudioTrack({
				assetId: "a1",
				durationSec: 5,
				timelineStartSec: 0,
				spanSec: 5,
				kind: "voiceover",
			}),
			createAudioTrack({
				assetId: "a2",
				durationSec: 5,
				timelineStartSec: 0,
				spanSec: 5,
				kind: "music",
			}),
		];

		// Voiceover and music over the same stretch: the audio lane, two rows tall.
		act(() => {
			useProjectStore.setState({ document: doc });
		});
		expect(root.style.gridTemplateRows).toBe(
			rows(withLanes(ONE_AUDIO_ROW_PX + AUDIO_ROW_EXPANSION_PX)),
		);

		act(() => {
			useProjectStore.setState({ document: { ...doc, audioTracks: [doc.audioTracks[0]] } });
		});
		expect(root.style.gridTemplateRows).toBe(rows(withLanes(ONE_AUDIO_ROW_PX)));

		// No audio left: the lane goes, and the panel with it.
		act(() => {
			useProjectStore.setState({ document: { ...doc, audioTracks: [] } });
		});
		expect(root.style.gridTemplateRows).toBe(rows(EMPTY_TIMELINE_CONTENT_HEIGHT_PX));
	});

	it("grows with overlapping annotation rows, caps at MAX and comes back when they go", () => {
		useProjectStore.getState().clear();
		const { container } = renderShell();
		const root = container.firstElementChild as HTMLElement;
		const doc = createEmptyDocument({ projectId: "p", title: "t" });
		doc.annotations = Array.from({ length: 16 }, (_, i) =>
			annotationRegionSchema.parse({
				id: `ann-${i}`,
				startMs: 0,
				endMs: 5000,
				type: "text",
				content: "Hello",
				zIndex: i,
				position: { x: 20, y: 20 },
				size: { width: 30, height: 20 },
				style: { color: "#ffffff", fontSize: 32, fontFamily: "Inter" },
			}),
		);
		act(() => {
			useProjectStore.setState({ document: { ...doc, annotations: doc.annotations.slice(0, 2) } });
		});
		expect(root.style.gridTemplateRows).toBe(rows(withLanes(regionLaneHeight(2))));
		act(() => {
			useProjectStore.setState({ document: doc });
		});
		expect(root.style.gridTemplateRows).toBe(rows(MAX_TIMELINE_HEIGHT_PX));
		// The same sixteen, one after another: one row.
		act(() => {
			useProjectStore.setState({
				document: {
					...doc,
					annotations: doc.annotations.map((ann, i) => ({
						...ann,
						startMs: i * 1000,
						endMs: (i + 1) * 1000,
					})),
				},
			});
		});
		expect(root.style.gridTemplateRows).toBe(rows(withLanes(regionLaneHeight(1))));

		act(() => {
			useProjectStore.setState({ document: { ...doc, annotations: [] } });
		});
		expect(root.style.gridTemplateRows).toBe(rows(EMPTY_TIMELINE_CONTENT_HEIGHT_PX));
	});

	// A drag against the cap moves nothing, so it must store nothing: otherwise the panel
	// would come back a different height once the content shrank under the cap.
	it.each([
		{ rowCount: 16, deltaY: 0, expectedOffset: 0 },
		{ rowCount: 16, deltaY: -1, expectedOffset: 0 },
		{ rowCount: 16, deltaY: 1, expectedOffset: -1 },
		{ rowCount: 20, deltaY: 0, expectedOffset: 0 },
		{ rowCount: 20, deltaY: -1, expectedOffset: 0 },
		{ rowCount: 20, deltaY: 1, expectedOffset: -1 },
	])("stores only what the panel moved by after a $deltaY px resize with $rowCount capped annotation rows", async ({
		rowCount,
		deltaY,
		expectedOffset,
	}) => {
		useProjectStore.getState().clear();
		const doc = createEmptyDocument({ projectId: "p", title: "t" });
		doc.annotations = Array.from({ length: rowCount }, (_, i) =>
			annotationRegionSchema.parse({
				id: `ann-${i}`,
				startMs: 0,
				endMs: 5000,
				type: "text",
				content: "Hello",
				zIndex: i,
				position: { x: 20, y: 20 },
				size: { width: 30, height: 20 },
				style: { color: "#ffffff", fontSize: 32, fontFamily: "Inter" },
			}),
		);
		useProjectStore.setState({ document: doc });
		const { container } = renderShell();
		const root = container.firstElementChild as HTMLElement;
		const handle = container.querySelector(
			'[role="separator"][aria-orientation="horizontal"]',
		) as HTMLElement;
		expect(root.style.gridTemplateRows).toBe(rows(MAX_TIMELINE_HEIGHT_PX));

		await act(async () => {
			fireEvent.pointerDown(handle, { clientY: 400 });
			fireEvent.pointerMove(window, { clientY: 400 + deltaY });
			fireEvent.pointerUp(window);
		});
		expect(localStorage.getItem(TIMELINE_HEIGHT_OFFSET_KEY)).toBe(String(expectedOffset));

		await act(async () => {
			useProjectStore.setState({ document: { ...doc, annotations: [] } });
		});
		expect(root.style.gridTemplateRows).toBe(
			rows(EMPTY_TIMELINE_CONTENT_HEIGHT_PX + expectedOffset),
		);
	});
});
