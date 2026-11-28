// The selected cursor override, drawn on the preview: its path through the picture and a
// handle on each point, the way `ZoomFocusOverlay` puts a zoom's focus on it.
//
// WHERE the pointer goes is edited here; WHEN it arrives is the tick on the timeline's pill.
// A press on the picture places a point at the playhead (or moves the one already there), a
// drag on a handle moves that point, a double-click removes it. The compositor redraws the
// pointer from the same override as it changes, so the handles and the drawn pointer agree.

import { type PointerEvent as ReactPointerEvent, useMemo, useRef } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import type { AxcutCursorOverride } from "@/lib/ai-edition/schema";
import { rafCoalesce } from "@/lib/ai-edition/store/rafCoalesce";
import {
	CURSOR_POINT_MERGE_MS,
	patchCursorOverridePoint,
	withCursorOverridePoint,
	withoutCursorOverridePoint,
} from "@/lib/ai-edition/timeline/cursor-overrides";
import type { CursorStageMapping } from "@/lib/ai-edition/timeline/cursor-stage";
import { formatSec } from "@/lib/ai-edition/timeline/format";
import styles from "./CursorPathOverlay.module.css";

/** How far a press may wander and still be a click rather than the start of a drag. */
const PRESS_JITTER_PX = 3;

type OverrideChange = (override: AxcutCursorOverride) => AxcutCursorOverride;

interface CursorPathOverlayProps {
	override: AxcutCursorOverride;
	/** The recording millisecond under the playhead, or null when the playhead is not on this
	 *  take's footage. A point is placed at it. */
	playheadMs: number | null;
	mapping: CursorStageMapping;
	/** Called on every pointermove while dragging: local only, must be cheap. */
	onChange: (id: string, change: OverrideChange) => void;
	/** Called once on release, to save what the drag left. */
	onCommit: () => void;
	/** One saved edit: a point removed. */
	onEdit: (id: string, change: OverrideChange) => void;
	/** Puts the playhead on a recording millisecond of this take. */
	onSeekToMs: (timeMs: number) => void;
}

export function CursorPathOverlay({
	override,
	playheadMs,
	mapping,
	onChange,
	onCommit,
	onEdit,
	onSeekToMs,
}: CursorPathOverlayProps) {
	const t = useScopedT("timeline");
	const rootRef = useRef<HTMLDivElement | null>(null);
	// One live write per frame: each one rebuilds the scene and has the compositor read the
	// pointer again, which is the right price once per picture and not once per mouse event.
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const live = useMemo(
		() => rafCoalesce((id: string, change: OverrideChange) => onChangeRef.current(id, change)),
		[],
	);

	const frameAt = (clientX: number, clientY: number) => {
		const rect = rootRef.current?.getBoundingClientRect();
		if (!rect?.width || !rect.height) return null;
		return mapping.toFrame((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height);
	};

	/** Follows the pointer until it is released, then saves once. */
	const drag = (change: (position: { cx: number; cy: number }) => OverrideChange) => {
		const move = (ev: PointerEvent) => {
			const position = frameAt(ev.clientX, ev.clientY);
			if (position) live(override.id, change(position));
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			live.flush();
			onCommit();
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	const inSpan =
		playheadMs !== null &&
		playheadMs >= override.sourceStartMs &&
		playheadMs <= override.sourceEndMs;

	// A press on the picture: the pointer is HERE at the playhead. Held, the point follows.
	const placePoint = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (e.button !== 0 || !inSpan || playheadMs === null) return;
		const position = frameAt(e.clientX, e.clientY);
		if (!position) return;
		e.preventDefault();
		e.stopPropagation();
		const place = (at: { cx: number; cy: number }) => (o: AxcutCursorOverride) =>
			withCursorOverridePoint(o, playheadMs, at) ?? o;
		onChange(override.id, place(position));
		drag(place);
	};

	const startPointDrag = (e: ReactPointerEvent, index: number) => {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		const startX = e.clientX;
		const startY = e.clientY;
		const timeMs = override.points[index].timeMs;
		let moved = false;
		const move = (ev: PointerEvent) => {
			if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) <= PRESS_JITTER_PX) {
				return;
			}
			moved = true;
			const position = frameAt(ev.clientX, ev.clientY);
			if (position) live(override.id, (o) => patchCursorOverridePoint(o, index, position));
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			if (moved) {
				live.flush();
				onCommit();
			} else {
				// A press that did not move: show the pointer on this point.
				onSeekToMs(timeMs);
			}
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	const staged = override.points.map((point) => mapping.toStage(point.cx, point.cy));
	const line = staged.map(({ x, y }) => `${x * 100},${y * 100}`).join(" ");
	return (
		<div
			ref={rootRef}
			className={styles.overlay}
			data-testid="cursor-path-overlay"
			// Only where a press would place a point: elsewhere it goes through to the picture.
			style={{ pointerEvents: inSpan ? "auto" : "none", cursor: inSpan ? "crosshair" : "default" }}
			onPointerDown={placePoint}
		>
			{staged.length > 1 ? (
				<svg className={styles.path} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
					<polyline className={styles.pathEdge} points={line} />
					<polyline className={styles.pathLine} points={line} />
				</svg>
			) : null}
			{override.points.map((point, index) => {
				const text = t(point.click ? "cursor.overlayClick" : "cursor.overlayPoint", {
					time: formatSec(point.timeMs / 1000),
				});
				return (
					<button
						key={`${point.timeMs}:${index}`}
						type="button"
						className={styles.point}
						data-click={point.click || undefined}
						data-recorded={point.recorded || undefined}
						data-current={
							(playheadMs !== null &&
								Math.abs(point.timeMs - playheadMs) <= CURSOR_POINT_MERGE_MS) ||
							undefined
						}
						style={{ left: `${staged[index].x * 100}%`, top: `${staged[index].y * 100}%` }}
						aria-label={text}
						title={text}
						onPointerDown={(e) => startPointDrag(e, index)}
						onDoubleClick={(e) => {
							e.stopPropagation();
							onEdit(override.id, (o) => withoutCursorOverridePoint(o, index));
						}}
					/>
				);
			})}
		</div>
	);
}
