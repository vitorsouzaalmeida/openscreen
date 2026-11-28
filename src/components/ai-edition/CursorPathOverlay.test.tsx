// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AxcutCursorOverride } from "@/lib/ai-edition/schema";
import { cursorStageMapping } from "@/lib/ai-edition/timeline/cursor-stage";
import { CursorPathOverlay } from "./CursorPathOverlay";

vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: () => (key: string, vars?: Record<string, string>) =>
		vars ? `${key} ${vars.time}` : key,
}));

const OVERRIDE: AxcutCursorOverride = {
	id: "cursor_1",
	assetId: "asset_1",
	sourceStartMs: 2000,
	sourceEndMs: 6000,
	points: [
		{ timeMs: 2000, cx: 0.1, cy: 0.2, recorded: true },
		{ timeMs: 4000, cx: 0.5, cy: 0.5, click: true },
	],
	origin: "user",
};
const MAPPING = cursorStageMapping({
	crop: { x: 0, y: 0, width: 1, height: 1 },
	rotation: 0,
	cover: null,
});

function renderOverlay(playheadMs: number | null) {
	const handlers = {
		onChange: vi.fn(),
		onCommit: vi.fn(),
		onEdit: vi.fn(),
		onSeekToMs: vi.fn(),
	};
	render(
		<CursorPathOverlay
			override={OVERRIDE}
			playheadMs={playheadMs}
			mapping={MAPPING}
			{...handlers}
		/>,
	);
	const overlay = screen.getByTestId("cursor-path-overlay");
	// A 200×100 stage at the origin.
	overlay.getBoundingClientRect = () =>
		({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 }) as DOMRect;
	/** What a change handed to `onChange` / `onEdit` makes of the override. */
	const applied = (mock: ReturnType<typeof vi.fn>) =>
		(mock.mock.calls.at(-1)?.[1] as (o: AxcutCursorOverride) => AxcutCursorOverride)(OVERRIDE);
	return { ...handlers, overlay, handles: () => screen.getAllByRole("button"), applied };
}

describe("CursorPathOverlay", () => {
	beforeEach(() => {
		vi.stubGlobal("PointerEvent", MouseEvent);
		// One live write per frame in the app; at once here, so each move can be read back.
		vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
			fn(0);
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("puts a handle on each point, where the picture shows it", () => {
		const { handles } = renderOverlay(3000);
		expect(
			handles().map((handle) => [
				handle.style.left,
				handle.style.top,
				handle.dataset.recorded,
				handle.dataset.click,
			]),
		).toEqual([
			["10%", "20%", "true", undefined],
			["50%", "50%", undefined, "true"],
		]);
	});

	it("places a point at the playhead where the picture is pressed, and saves on release", () => {
		const { overlay, onChange, onCommit, applied } = renderOverlay(3000);
		fireEvent.pointerDown(overlay, { button: 0, clientX: 150, clientY: 25 });
		expect(applied(onChange).points).toEqual([
			OVERRIDE.points[0],
			{ timeMs: 3000, cx: 0.75, cy: 0.25 },
			OVERRIDE.points[1],
		]);
		expect(onCommit).not.toHaveBeenCalled();
		// Held, the point follows the pointer.
		fireEvent.pointerMove(window, { clientX: 100, clientY: 80 });
		expect(applied(onChange).points[1]).toEqual({ timeMs: 3000, cx: 0.5, cy: 0.8 });
		fireEvent.pointerUp(window);
		expect(onCommit).toHaveBeenCalledTimes(1);
	});

	it("moves the point already at the playhead instead of adding one beside it", () => {
		const { overlay, onChange, applied } = renderOverlay(4010);
		fireEvent.pointerDown(overlay, { button: 0, clientX: 20, clientY: 90 });
		expect(applied(onChange).points).toEqual([
			OVERRIDE.points[0],
			{ timeMs: 4000, cx: 0.1, cy: 0.9, click: true },
		]);
		fireEvent.pointerUp(window);
	});

	it("takes no press on the picture while the playhead is outside the override", () => {
		for (const playheadMs of [1000, 7000, null]) {
			const { overlay, onChange } = renderOverlay(playheadMs);
			expect(overlay.style.pointerEvents).toBe("none");
			fireEvent.pointerDown(overlay, { button: 0, clientX: 50, clientY: 50 });
			expect(onChange).not.toHaveBeenCalled();
			cleanup();
		}
	});

	it("moves a point dragged by its handle, as one saved gesture", () => {
		const { handles, onChange, onCommit, onSeekToMs, applied } = renderOverlay(3000);
		fireEvent.pointerDown(handles()[1], { button: 0, clientX: 100, clientY: 50 });
		fireEvent.pointerMove(window, { clientX: 160, clientY: 30 });
		expect(applied(onChange).points[1]).toEqual({ timeMs: 4000, cx: 0.8, cy: 0.3, click: true });
		fireEvent.pointerUp(window);
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onSeekToMs).not.toHaveBeenCalled();
	});

	it("makes a join the user's own point once it is dragged", () => {
		const { handles, onChange, applied } = renderOverlay(3000);
		fireEvent.pointerDown(handles()[0], { button: 0, clientX: 20, clientY: 20 });
		fireEvent.pointerMove(window, { clientX: 60, clientY: 60 });
		expect(applied(onChange).points[0]).toEqual({ timeMs: 2000, cx: 0.3, cy: 0.6 });
		fireEvent.pointerUp(window);
	});

	it("puts the playhead on a point pressed without moving, and changes nothing", () => {
		const { handles, onChange, onCommit, onSeekToMs } = renderOverlay(3000);
		fireEvent.pointerDown(handles()[1], { button: 0, clientX: 100, clientY: 50 });
		// A pixel of jitter is still a click.
		fireEvent.pointerMove(window, { clientX: 101, clientY: 50 });
		fireEvent.pointerUp(window);
		expect(onSeekToMs).toHaveBeenCalledWith(4000);
		expect(onChange).not.toHaveBeenCalled();
		expect(onCommit).not.toHaveBeenCalled();
	});

	it("removes a point on a double-click", () => {
		const { handles, onEdit, applied } = renderOverlay(3000);
		fireEvent.doubleClick(handles()[1]);
		expect(applied(onEdit).points).toEqual([OVERRIDE.points[0]]);
	});
});
