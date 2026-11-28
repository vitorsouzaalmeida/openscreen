// Cursor overrides: a stretch of a take's pointer drawn again, by hand or by an agent.
//
// The recorded track (`<video>.cursor.json`) is read-only. An override lives in the document
// (`cursorOverrides`) and replaces the recording over its span wherever the track is read: the
// compositor splices it in when it loads the track (`cursorPatches` in the scene), and every
// TypeScript reader goes through `applyCursorOverrides`. Removing the override is what brings
// the recording back, which is why nothing here ever writes a sidecar.
//
// This module is the ONE place that turns an override into pointer samples. The compositor is
// handed those samples ready-made and only swaps them in, so the preview, the export, the click
// sound and the zoom planner cannot disagree about where the drawn pointer went.
//
// Pure: no fs, no IPC, no store.

import type {
	AxcutAsset,
	AxcutCursorOverride,
	AxcutCursorOverridePoint,
	AxcutDocument,
} from "../schema";
import { clampSpanAgainstNeighbours } from "./timelineMap";

/** The rate OpenScreen's own pointer sampler records at; a glide is sampled at it too. */
const GLIDE_STEP_MS = 33;
/** A hand reaches for the next control in about this long, then arrives. */
export const CURSOR_GLIDE_MS = 600;
const CLICK_HOLD_MS = 80;
/**
 * How often a pointer at rest is reported. Far coarser than a glide on purpose: the samples
 * ride in the scene, which is rebuilt on every edit, and an agent's override can span a whole
 * take. Every reader interpolates between samples, so a still pointer needs few of them; it
 * still needs some, because the auto-hide and the zoom planner read a gap as "no data".
 */
const REST_STEP_MS = 500;
/** Two points closer than this are the same point: a click on an existing one moves it. */
export const CURSOR_POINT_MERGE_MS = 40;
/** The shortest span an override may be resized to. */
export const MIN_CURSOR_OVERRIDE_MS = 1;

/** One pointer sample of an override, in the sidecar's own shape so every reader of the
 *  recorded track reads it unchanged. No `cursorType`: absent reads as the arrow. */
export interface CursorOverrideSample {
	timeMs: number;
	cx: number;
	cy: number;
	visible: boolean;
	interactionType: "move" | "click" | "mouseup";
}

/** A position in the recorded frame, as fractions of it. */
export interface CursorPosition {
	cx: number;
	cy: number;
}

/** Where the recorded pointer was at a recording millisecond; null when nothing was recorded. */
export type RecordedCursorAt = (timeMs: number) => CursorPosition | null;

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5);
const wholeMs = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

/** The override's points in time order, each held inside its span. */
function orderedPoints(override: AxcutCursorOverride): AxcutCursorOverridePoint[] {
	const { sourceStartMs: start, sourceEndMs: end } = override;
	return override.points
		.map((point) => ({ ...point, timeMs: Math.min(end, Math.max(start, point.timeMs)) }))
		.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * The pointer an override draws, as a real mouse would have left it: at rest on a point, then a
 * short eased glide that ARRIVES on the next point at that point's time, then at rest again.
 * The pointer sits on the first point from the span's start and on the last one to its end.
 *
 * An override with no point draws nothing of its own: the recording is still cut out over the
 * span, so every reader interpolates straight across it, from where the pointer was before to
 * where it is after. Hidden, it is held off screen at the centre instead, because a sample is
 * the only thing that can carry "not visible".
 */
export function cursorOverrideSamples(override: AxcutCursorOverride): CursorOverrideSample[] {
	const start = wholeMs(override.sourceStartMs);
	const end = Math.max(start, wholeMs(override.sourceEndMs));
	const visible = !override.hidden;
	const points = orderedPoints(override);
	const samples: CursorOverrideSample[] = [];
	const push = (
		timeMs: number,
		cx: number,
		cy: number,
		interactionType: CursorOverrideSample["interactionType"] = "move",
	) => {
		const at = Math.min(end, Math.max(start, Math.round(timeMs)));
		const last = samples[samples.length - 1];
		if (last && last.timeMs === at) {
			// One sample per millisecond. A press or a release already there is the event that
			// happened then; a plain move gives way to whatever comes after it.
			if (last.interactionType !== "move") return;
			samples.pop();
		}
		samples.push({ timeMs: at, cx: clamp01(cx), cy: clamp01(cy), visible, interactionType });
	};

	if (points.length === 0) {
		if (!visible) {
			push(start, 0.5, 0.5);
			push(end, 0.5, 0.5);
		}
		return samples;
	}

	let from = { t: start, x: points[0].cx, y: points[0].cy };
	push(start, from.x, from.y);
	for (const point of points) {
		const t = Math.max(from.t, wholeMs(point.timeMs));
		const glideStart = Math.max(from.t, t - CURSOR_GLIDE_MS);
		for (let s = from.t + REST_STEP_MS; s < glideStart; s += REST_STEP_MS) {
			push(s, from.x, from.y);
		}
		if (point.cx !== from.x || point.cy !== from.y) {
			for (let s = glideStart; s < t; s += GLIDE_STEP_MS) {
				const k = (s - glideStart) / (t - glideStart);
				const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
				push(s, from.x + (point.cx - from.x) * eased, from.y + (point.cy - from.y) * eased);
			}
		}
		push(t, point.cx, point.cy, point.click ? "click" : "move");
		let held = t;
		if (point.click) {
			held = Math.min(end, t + CLICK_HOLD_MS);
			push(held, point.cx, point.cy, "mouseup");
		}
		from = { t: held, x: point.cx, y: point.cy };
	}
	for (let s = from.t + REST_STEP_MS; s < end; s += REST_STEP_MS) push(s, from.x, from.y);
	push(end, from.x, from.y);
	return samples;
}

/** The overrides of one asset, in time order. */
export function cursorOverridesForAsset(
	document: Pick<AxcutDocument, "cursorOverrides"> | null | undefined,
	assetId: string | null | undefined,
): AxcutCursorOverride[] {
	if (!assetId) return [];
	return (document?.cursorOverrides ?? [])
		.filter((override) => override.assetId === assetId)
		.sort((a, b) => a.sourceStartMs - b.sourceStartMs);
}

/**
 * A take's pointer as it is drawn: the recorded samples, with every override's span cut out and
 * its own samples put in. With no override the recorded array comes back as it was given, so a
 * caller that memoises on it keeps its identity.
 *
 * A take with no recording at all (a system-cursor take, a video an agent's script captured)
 * is an empty array here, and the result is then the overrides alone.
 */
export function applyCursorOverrides<S extends { timeMs: number }>(
	recorded: readonly S[],
	overrides: readonly AxcutCursorOverride[],
): Array<S | CursorOverrideSample> {
	if (overrides.length === 0) return recorded as S[];
	const kept = recorded.filter(
		(sample) =>
			!overrides.some(
				(override) =>
					sample.timeMs >= override.sourceStartMs && sample.timeMs <= override.sourceEndMs,
			),
	);
	const drawn = overrides.flatMap(cursorOverrideSamples);
	return [...kept, ...drawn].sort((a, b) => a.timeMs - b.timeMs);
}

/** One asset's override as the compositor takes it (`Scene::cursor_patches`, scene.rs). */
export interface SceneCursorPatch {
	/** The take's screen video, as `clips[].screenPath` names it. */
	screenPath: string;
	/** The span cut out of the recorded track, in its own milliseconds, ends included. */
	startMs: number;
	endMs: number;
	samples: CursorOverrideSample[];
}

/** The scene's `cursorPatches`: every override of an asset the scene can name by its file. */
export function cursorPatchesForScene(
	document: Pick<AxcutDocument, "cursorOverrides">,
	assetById: ReadonlyMap<string, Pick<AxcutAsset, "originalPath">>,
): SceneCursorPatch[] {
	return (document.cursorOverrides ?? [])
		.flatMap((override) => {
			const screenPath = assetById.get(override.assetId)?.originalPath;
			if (!screenPath) return [];
			return [
				{
					screenPath,
					startMs: override.sourceStartMs,
					endMs: override.sourceEndMs,
					samples: cursorOverrideSamples(override),
				},
			];
		})
		.sort((a, b) => a.startMs - b.startMs);
}

/** Where a sorted pointer track puts the pointer at `timeMs`, interpolated; held at its ends. */
export function cursorPositionAt(
	samples: ReadonlyArray<{ timeMs: number; cx: number; cy: number }>,
	timeMs: number,
): CursorPosition | null {
	if (samples.length === 0) return null;
	if (timeMs <= samples[0].timeMs) return { cx: samples[0].cx, cy: samples[0].cy };
	const last = samples[samples.length - 1];
	if (timeMs >= last.timeMs) return { cx: last.cx, cy: last.cy };
	let lo = 0;
	let hi = samples.length - 1;
	while (lo < hi - 1) {
		const mid = (lo + hi) >>> 1;
		if (samples[mid].timeMs <= timeMs) lo = mid;
		else hi = mid;
	}
	const before = samples[lo];
	const after = samples[hi];
	const span = after.timeMs - before.timeMs;
	const k = span > 0 ? (timeMs - before.timeMs) / span : 0;
	return {
		cx: before.cx + (after.cx - before.cx) * k,
		cy: before.cy + (after.cy - before.cy) * k,
	};
}

/** A point that joins the override to the recording: read from it, and read again when the
 *  span's edge moves. Null when the take recorded no pointer there. */
function recordedPoint(
	timeMs: number,
	recordedAt: RecordedCursorAt,
): AxcutCursorOverridePoint | null {
	const position = recordedAt(timeMs);
	return position
		? { timeMs, cx: clamp01(position.cx), cy: clamp01(position.cy), recorded: true }
		: null;
}

/**
 * A new override over `[startMs, endMs]` of the asset. It opens and closes on the recorded
 * pointer, so it joins the recording at both ends without a jump, and between them it does
 * what an override with those two points does: stays put, then glides across. That alone
 * removes a wobble or a detour; the user adds points from there.
 */
export function createCursorOverride(input: {
	id: string;
	assetId: string;
	startMs: number;
	endMs: number;
	recordedAt: RecordedCursorAt;
	origin?: AxcutCursorOverride["origin"];
}): AxcutCursorOverride {
	const start = wholeMs(Math.min(input.startMs, input.endMs));
	const end = Math.max(
		start + MIN_CURSOR_OVERRIDE_MS,
		wholeMs(Math.max(input.startMs, input.endMs)),
	);
	return {
		id: input.id,
		assetId: input.assetId,
		sourceStartMs: start,
		sourceEndMs: end,
		points: [recordedPoint(start, input.recordedAt), recordedPoint(end, input.recordedAt)].filter(
			(point): point is AxcutCursorOverridePoint => point !== null,
		),
		origin: input.origin ?? "user",
	};
}

/**
 * The override over a new span. Its joins to the recording follow the edges and are read again
 * there. A point the user placed keeps its place in the picture and its distance from the
 * start when the whole span moves (`shiftPoints`), and its own time when only an edge does; one
 * left outside the new span is dropped with the stretch it belonged to.
 */
export function withCursorOverrideSpan(
	override: AxcutCursorOverride,
	startMs: number,
	endMs: number,
	recordedAt: RecordedCursorAt,
	shiftPoints = false,
): AxcutCursorOverride {
	const start = wholeMs(Math.min(startMs, endMs));
	const end = Math.max(start + MIN_CURSOR_OVERRIDE_MS, wholeMs(Math.max(startMs, endMs)));
	const delta = shiftPoints ? start - override.sourceStartMs : 0;
	const points: AxcutCursorOverridePoint[] = [];
	for (const point of override.points) {
		if (point.recorded) {
			// A join sits on an edge by construction: the nearer one is the one it follows.
			const atStart =
				Math.abs(point.timeMs - override.sourceStartMs) <=
				Math.abs(point.timeMs - override.sourceEndMs);
			const joined = recordedPoint(atStart ? start : end, recordedAt);
			if (joined) points.push(point.click ? { ...joined, click: true } : joined);
			continue;
		}
		const timeMs = point.timeMs + delta;
		if (timeMs >= start && timeMs <= end) points.push({ ...point, timeMs });
	}
	return {
		...override,
		sourceStartMs: start,
		sourceEndMs: end,
		points: points.sort((a, b) => a.timeMs - b.timeMs),
	};
}

/**
 * The span an edit of `id` may take: inside `[minMs, maxMs]` (the footage the grabbed clip
 * shows) and clear of the asset's other overrides, which act as walls exactly as a zoom's
 * neighbours do (`clampSpanAgainstNeighbours`). Two overrides over one instant would have no
 * order to be applied in.
 */
export function clampCursorOverrideSpan(
	overrides: readonly AxcutCursorOverride[],
	id: string | null,
	assetId: string,
	desired: { startMs: number; endMs: number },
	from: { startMs: number; endMs: number },
	limits: { minMs: number; maxMs: number },
): { startMs: number; endMs: number } {
	const length = desired.endMs - desired.startMs;
	let start = Math.max(limits.minMs, Math.min(desired.startMs, limits.maxMs));
	let end = Math.max(limits.minMs, Math.min(desired.endMs, limits.maxMs));
	// A move keeps its length against the footage's ends, as it does against a neighbour.
	if (from.endMs - from.startMs === length) {
		if (desired.startMs < limits.minMs) end = Math.min(limits.maxMs, start + length);
		else if (desired.endMs > limits.maxMs) start = Math.max(limits.minMs, end - length);
	}
	const walls = overrides
		.filter((other) => other.assetId === assetId && other.id !== id)
		.map((other) => ({ start: other.sourceStartMs, end: other.sourceEndMs }));
	const clear = clampSpanAgainstNeighbours({ start, end }, walls, {
		start: from.startMs,
		end: from.endMs,
	});
	return { startMs: wholeMs(clear.start), endMs: wholeMs(clear.end) };
}

/**
 * The override with a point at `timeMs`. A point already within `CURSOR_POINT_MERGE_MS` of it
 * is the one meant: it takes the new position (and stops being a join to the recording) and
 * keeps its time and its click. Null when `timeMs` is outside the span.
 */
export function withCursorOverridePoint(
	override: AxcutCursorOverride,
	timeMs: number,
	position: CursorPosition,
): AxcutCursorOverride | null {
	const at = wholeMs(timeMs);
	if (at < override.sourceStartMs || at > override.sourceEndMs) return null;
	const placed = { cx: clamp01(position.cx), cy: clamp01(position.cy) };
	let nearest = -1;
	for (const [index, point] of override.points.entries()) {
		const distance = Math.abs(point.timeMs - at);
		if (distance > CURSOR_POINT_MERGE_MS) continue;
		if (nearest < 0 || distance < Math.abs(override.points[nearest].timeMs - at)) nearest = index;
	}
	if (nearest >= 0) return patchCursorOverridePoint(override, nearest, placed);
	return {
		...override,
		points: [...override.points, { timeMs: at, ...placed }].sort((a, b) => a.timeMs - b.timeMs),
	};
}

/**
 * The override with its point `index` changed. A new position makes the point the user's own;
 * a new time is held between its neighbours, so points never change order under a drag.
 */
export function patchCursorOverridePoint(
	override: AxcutCursorOverride,
	index: number,
	patch: Partial<Pick<AxcutCursorOverridePoint, "timeMs" | "cx" | "cy" | "click">>,
): AxcutCursorOverride {
	const point = override.points[index];
	if (!point) return override;
	const next: AxcutCursorOverridePoint = { ...point };
	if (patch.cx !== undefined || patch.cy !== undefined) {
		next.cx = clamp01(patch.cx ?? point.cx);
		next.cy = clamp01(patch.cy ?? point.cy);
		delete next.recorded;
	}
	if (patch.timeMs !== undefined) {
		const floor = override.points[index - 1]?.timeMs ?? override.sourceStartMs;
		const ceiling = override.points[index + 1]?.timeMs ?? override.sourceEndMs;
		next.timeMs = Math.min(ceiling, Math.max(floor, wholeMs(patch.timeMs)));
		delete next.recorded;
	}
	if (patch.click !== undefined) {
		if (patch.click) next.click = true;
		else delete next.click;
	}
	return { ...override, points: override.points.map((p, i) => (i === index ? next : p)) };
}

export function withoutCursorOverridePoint(
	override: AxcutCursorOverride,
	index: number,
): AxcutCursorOverride {
	return { ...override, points: override.points.filter((_, i) => i !== index) };
}

/** The document with override `id` replaced by what `change` makes of it, or removed on null. */
export function mapCursorOverride<D extends Pick<AxcutDocument, "cursorOverrides">>(
	document: D,
	id: string,
	change: (override: AxcutCursorOverride) => AxcutCursorOverride | null,
): D {
	const overrides = (document.cursorOverrides ?? []).flatMap((override) => {
		if (override.id !== id) return [override];
		const next = change(override);
		return next ? [next] : [];
	});
	return withCursorOverrides(document, overrides);
}

/** The document with this list of overrides. An empty list leaves no key behind, so a project
 *  that never had one saves exactly as it did before overrides existed. */
export function withCursorOverrides<D extends Pick<AxcutDocument, "cursorOverrides">>(
	document: D,
	overrides: AxcutCursorOverride[],
): D {
	const { cursorOverrides: _dropped, ...rest } = document;
	return (overrides.length > 0 ? { ...rest, cursorOverrides: overrides } : rest) as D;
}

/**
 * Where on the RAW ruler an override shows: one stretch per clip of its asset whose footage
 * overlaps it. A raw clip plays its source at 1:1, so a recording millisecond maps to the ruler
 * by the clip's own offset. Trims leave their space on the raw ruler, so a trimmed stretch still
 * has its place there; it only does not play.
 */
export function cursorOverrideRulerSpans(
	override: Pick<AxcutCursorOverride, "assetId" | "sourceStartMs" | "sourceEndMs">,
	clips: ReadonlyArray<{
		id: string;
		assetId: string;
		sourceStartSec: number;
		sourceEndSec?: number;
		timelineStartSec: number;
		timelineEndSec: number;
	}>,
): Array<{ clipId: string; startSec: number; endSec: number }> {
	const spans: Array<{ clipId: string; startSec: number; endSec: number }> = [];
	for (const clip of clips) {
		if (clip.assetId !== override.assetId) continue;
		const clipSourceEnd =
			clip.sourceEndSec ?? clip.sourceStartSec + (clip.timelineEndSec - clip.timelineStartSec);
		const from = Math.max(override.sourceStartMs / 1000, clip.sourceStartSec);
		const to = Math.min(override.sourceEndMs / 1000, clipSourceEnd);
		if (to <= from) continue;
		spans.push({
			clipId: clip.id,
			startSec: clip.timelineStartSec + (from - clip.sourceStartSec),
			endSec: clip.timelineStartSec + (to - clip.sourceStartSec),
		});
	}
	return spans;
}
