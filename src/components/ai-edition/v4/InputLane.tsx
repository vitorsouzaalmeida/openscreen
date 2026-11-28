// The timeline's Clicks and Keys lanes: every click and key press of the take, as marks.
//
// Nothing about a mark can be edited but whether it sounds. Picking one (or a stretch of them)
// selects it, and the inspector's switch, or Delete, takes its sound out; the mark stays, drawn
// hollow, so the same action gives the sound back. A press here never scrubs: the marks are the
// one thing on these lanes that can be aimed at, and the lane around them still scrubs like any
// empty part of the tracks.

import { Keyboard, MousePointerClick } from "lucide-react";
import { memo, type PointerEvent as ReactPointerEvent, type RefObject, useMemo } from "react";
import type { InputSoundKind } from "@/lib/ai-edition/inputSounds";
import { formatSec } from "@/lib/ai-edition/timeline/format";
import {
	type LaneMark,
	laneEventsBetween,
	laneEventsSpan,
	laneMarks,
	type PlacedLaneEvent,
} from "@/lib/ai-edition/timeline/input-lane";
import { INPUT_LANE_HEIGHT_PX } from "@/lib/ai-edition/timeline/timelineHeight";
import styles from "./InputLane.module.css";

/** How close two presses may be on screen before they share one mark. A click is rare and
 *  drawn as a dot; keys come in bursts and are drawn as thin bars. */
const MARK_PX: Record<InputSoundKind, number> = { click: 9, key: 4 };

export interface InputLaneLabels {
	/** The lane's name: its accessible label and the tip on its icon. */
	lane: string;
	/** What one mark says on hover, given how many presses it stands for and where. */
	mark: (count: number, at: string, sound: LaneMark["sound"]) => string;
}

export const InputLane = memo(function InputLane({
	kind,
	placed,
	total,
	nav,
	pxPerSec,
	canvasRef,
	selected,
	onSelect,
	labels,
}: {
	kind: InputSoundKind;
	/** The take's events on the ruler (`placeLaneEvents`). */
	placed: readonly PlacedLaneEvent[];
	total: number;
	/** The visible fraction of the timeline. */
	nav: { start: number; end: number };
	pxPerSec: number;
	canvasRef: RefObject<HTMLDivElement | null>;
	/** The presses picked on this lane, by recording millisecond. */
	selected: ReadonlySet<number>;
	onSelect: (timesMs: number[]) => void;
	labels: InputLaneLabels;
}) {
	const marks = useMemo(() => {
		// A mark's width of margin on each side, so one never pops in at the edge of the window.
		const marginSec = pxPerSec > 0 ? (MARK_PX[kind] * 2) / pxPerSec : 0;
		return laneMarks(
			placed,
			nav.start * total - marginSec,
			nav.end * total + marginSec,
			pxPerSec,
			MARK_PX[kind],
		);
	}, [placed, nav.start, nav.end, total, pxPerSec, kind]);

	// A press on a mark picks it; held and dragged, it picks everything up to the pointer.
	// With Shift it extends what is already picked up to this mark, like any list.
	const startSelect = (e: ReactPointerEvent, mark: LaneMark) => {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		const held = e.shiftKey ? laneEventsSpan(placed, selected) : null;
		const anchor = held
			? { fromSec: Math.min(held.fromSec, mark.fromSec), toSec: Math.max(held.toSec, mark.toSec) }
			: { fromSec: mark.fromSec, toSec: mark.toSec };
		onSelect(laneEventsBetween(placed, anchor.fromSec, anchor.toSec));
		const canvas = canvasRef.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const move = (ev: PointerEvent) => {
			const atSec = ((ev.clientX - rect.left) / rect.width) * total;
			onSelect(
				laneEventsBetween(placed, Math.min(anchor.fromSec, atSec), Math.max(anchor.toSec, atSec)),
			);
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	const Icon = kind === "click" ? MousePointerClick : Keyboard;
	return (
		<div
			className={styles.lane}
			role="group"
			aria-label={labels.lane}
			data-track-kind={kind}
			data-testid={`input-lane-${kind}`}
			style={{ height: INPUT_LANE_HEIGHT_PX }}
		>
			{/* Pinned to the visible window, not the zoomed canvas, so the lane still says what it
			    is however far the timeline is zoomed in. */}
			<span className={styles.name} style={{ left: `${nav.start * 100}%` }} title={labels.lane}>
				<Icon size={12} aria-hidden />
			</span>
			{marks.map((mark) => {
				const picked = mark.timesMs.every((timeMs) => selected.has(timeMs));
				const text = labels.mark(mark.timesMs.length, formatSec(mark.atSec), mark.sound);
				return (
					<button
						key={mark.timesMs[0]}
						type="button"
						// Not a tab stop: a take can hold thousands of them. The inspector's switch,
						// reached from the selection, is the keyboard's way in.
						tabIndex={-1}
						className={styles.mark}
						data-sound={mark.sound}
						data-selected={picked || undefined}
						aria-pressed={picked}
						aria-label={text}
						title={text}
						style={{ left: `${(mark.atSec / total) * 100}%` }}
						onPointerDown={(e) => startSelect(e, mark)}
					/>
				);
			})}
		</div>
	);
});
