// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeLaneEvents } from "@/lib/ai-edition/timeline/input-lane";
import { InputLane } from "./InputLane";

const CLIP = {
	assetId: "asset_1",
	sourceStartSec: 0,
	sourceEndSec: 10,
	timelineStartSec: 0,
	timelineEndSec: 10,
};
// Three clicks, the middle one silenced.
const PLACED = placeLaneEvents(
	[
		{ timeMs: 1000, muted: false },
		{ timeMs: 5000, muted: true },
		{ timeMs: 9000, muted: false },
	],
	"asset_1",
	[CLIP],
);
const LABELS = {
	lane: "Mouse clicks",
	mark: (count: number, at: string, sound: string) => `${count} at ${at} (${sound})`,
};

function renderLane(selected: number[] = [], onSelect = vi.fn(), onScrub = vi.fn()) {
	// A 1000px canvas for the 10 s: the lane's pointer maths reads its box.
	const canvas = document.createElement("div");
	canvas.getBoundingClientRect = () =>
		({ left: 0, top: 0, width: 1000, height: 100, right: 1000, bottom: 100 }) as DOMRect;
	render(
		// Stands in for the tracks, which scrub on a press.
		<div onPointerDown={onScrub}>
			<InputLane
				kind="click"
				placed={PLACED}
				total={10}
				nav={{ start: 0, end: 1 }}
				pxPerSec={100}
				canvasRef={{ current: canvas }}
				selected={new Set(selected)}
				onSelect={onSelect}
				labels={LABELS}
			/>
		</div>,
	);
	return { onSelect, onScrub, marks: () => screen.getAllByRole("button") };
}

describe("InputLane", () => {
	beforeEach(() => {
		vi.stubGlobal("PointerEvent", MouseEvent);
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("draws a mark per press, where it falls on the ruler, saying whether it sounds", () => {
		const { marks } = renderLane();
		expect(marks().map((mark) => [mark.style.left, mark.dataset.sound, mark.title])).toEqual([
			["10%", "on", "1 at 0:01.0 (on)"],
			["50%", "off", "1 at 0:05.0 (off)"],
			["90%", "on", "1 at 0:09.0 (on)"],
		]);
		expect(screen.getByRole("group", { name: "Mouse clicks" })).toBeTruthy();
	});

	it("picks the mark pressed, and does not scrub", () => {
		const { marks, onSelect, onScrub } = renderLane();
		fireEvent.pointerDown(marks()[1], { button: 0, clientX: 500 });
		expect(onSelect).toHaveBeenCalledWith([5000]);
		expect(onScrub).not.toHaveBeenCalled();
		fireEvent.pointerUp(window);
	});

	it("shows what is picked", () => {
		const { marks } = renderLane([5000]);
		expect(marks().map((mark) => mark.getAttribute("aria-pressed"))).toEqual([
			"false",
			"true",
			"false",
		]);
	});

	it("extends the selection to the mark pressed with Shift", () => {
		const { marks, onSelect } = renderLane([1000]);
		fireEvent.pointerDown(marks()[2], { button: 0, shiftKey: true, clientX: 900 });
		expect(onSelect).toHaveBeenLastCalledWith([1000, 5000, 9000]);
		fireEvent.pointerUp(window);
	});

	it("picks everything a press dragged along the lane passes over", () => {
		const { marks, onSelect } = renderLane();
		fireEvent.pointerDown(marks()[0], { button: 0, clientX: 100 });
		// Dragged to 6 s: the second mark is passed, the third is not.
		fireEvent.pointerMove(window, { clientX: 600 });
		expect(onSelect).toHaveBeenLastCalledWith([1000, 5000]);
		// And back before the first mark: only the mark the drag started on stays.
		fireEvent.pointerMove(window, { clientX: 20 });
		expect(onSelect).toHaveBeenLastCalledWith([1000]);
		fireEvent.pointerUp(window);
		// Released: the pointer no longer changes the selection.
		const calls = onSelect.mock.calls.length;
		fireEvent.pointerMove(window, { clientX: 950 });
		expect(onSelect).toHaveBeenCalledTimes(calls);
	});

	it("leaves a press of another button alone", () => {
		const { marks, onSelect } = renderLane();
		fireEvent.pointerDown(marks()[0], { button: 2, clientX: 100 });
		expect(onSelect).not.toHaveBeenCalled();
	});
});
