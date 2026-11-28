// Where a take's clicks and key presses fall on the timeline's Clicks and Keys lanes.
//
// The events are recorded on the take's own clock. The ruler shows a clip's footage at the
// clip's position, and the same take can sit under several clips, so an event is placed once
// per clip that shows it, the way its sound is (`clickPlacement`, clickSound.ts). Trims leave
// their space on the raw ruler: an event under a cut keeps its place there and only does not
// play.
//
// Pure: no DOM, no store.

export interface LaneEvent {
	/** The recording millisecond of the press. */
	timeMs: number;
	muted: boolean;
}

export interface PlacedLaneEvent extends LaneEvent {
	/** Where it sits on the raw ruler, in seconds. */
	rulerSec: number;
}

/** What a lane draws in one place: every press within a few pixels of each other. */
export interface LaneMark {
	/** The ruler second the mark is drawn at: the middle of the presses it stands for. */
	atSec: number;
	/** Where its first and last press sit, for a selection that starts or ends on it. */
	fromSec: number;
	toSec: number;
	timesMs: number[];
	/** Whether the presses under it sound: all of them, none, or some. */
	sound: "on" | "off" | "mixed";
}

interface LaneClip {
	assetId: string;
	sourceStartSec: number;
	sourceEndSec?: number;
	timelineStartSec: number;
	timelineEndSec: number;
}

/** Each event under each clip of the take that shows it, in ruler order. */
export function placeLaneEvents(
	events: readonly LaneEvent[],
	takeAssetId: string | null,
	clips: readonly LaneClip[],
): PlacedLaneEvent[] {
	if (!takeAssetId || events.length === 0) return [];
	const placed: PlacedLaneEvent[] = [];
	for (const clip of clips) {
		if (clip.assetId !== takeAssetId) continue;
		const fromMs = clip.sourceStartSec * 1000;
		const toMs =
			(clip.sourceEndSec ?? clip.sourceStartSec + (clip.timelineEndSec - clip.timelineStartSec)) *
			1000;
		for (const event of events) {
			if (event.timeMs < fromMs || event.timeMs >= toMs) continue;
			placed.push({
				...event,
				rulerSec: clip.timelineStartSec + (event.timeMs - fromMs) / 1000,
			});
		}
	}
	return placed.sort((a, b) => a.rulerSec - b.rulerSec);
}

/** The index of the first placed event at or after `sec`. */
function firstAtOrAfter(placed: readonly PlacedLaneEvent[], sec: number): number {
	let lo = 0;
	let hi = placed.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (placed[mid].rulerSec < sec) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * The marks to draw between two ruler seconds. Presses closer together than `markPx` on screen
 * share one mark: at that zoom they could not be told apart or aimed at anyway, and a typed
 * sentence would otherwise be hundreds of elements. Zooming in separates them, down to one
 * press per mark. Only the visible stretch is built, so a long take costs what the window
 * shows.
 */
export function laneMarks(
	placed: readonly PlacedLaneEvent[],
	fromSec: number,
	toSec: number,
	pxPerSec: number,
	markPx: number,
): LaneMark[] {
	if (!(pxPerSec > 0) || placed.length === 0) return [];
	const marks: LaneMark[] = [];
	const stepSec = markPx / pxPerSec;
	let bucket = Number.NaN;
	let current: (LaneMark & { muted: number }) | null = null;
	const close = () => {
		if (!current) return;
		const { muted, ...mark } = current;
		mark.atSec = (mark.fromSec + mark.toSec) / 2;
		mark.sound = muted === 0 ? "on" : muted === mark.timesMs.length ? "off" : "mixed";
		marks.push(mark);
	};
	for (let i = firstAtOrAfter(placed, fromSec); i < placed.length; i += 1) {
		const event = placed[i];
		if (event.rulerSec > toSec) break;
		// Buckets are fixed on the ruler, not on the window: a mark does not regroup as the
		// timeline pans under it.
		const at = Math.floor(event.rulerSec / stepSec);
		if (at !== bucket || !current) {
			close();
			bucket = at;
			current = {
				atSec: event.rulerSec,
				fromSec: event.rulerSec,
				toSec: event.rulerSec,
				timesMs: [],
				sound: "on",
				muted: 0,
			};
		}
		current.toSec = event.rulerSec;
		current.timesMs.push(event.timeMs);
		if (event.muted) current.muted += 1;
	}
	close();
	return marks;
}

/** The presses between two ruler seconds, ends included, each named once. */
export function laneEventsBetween(
	placed: readonly PlacedLaneEvent[],
	aSec: number,
	bSec: number,
): number[] {
	const from = Math.min(aSec, bSec);
	const to = Math.max(aSec, bSec);
	const times = new Set<number>();
	for (let i = firstAtOrAfter(placed, from); i < placed.length; i += 1) {
		if (placed[i].rulerSec > to) break;
		times.add(placed[i].timeMs);
	}
	return [...times];
}

/** The stretch of ruler a set of presses covers; null when none of them is placed. */
export function laneEventsSpan(
	placed: readonly PlacedLaneEvent[],
	timesMs: ReadonlySet<number>,
): { fromSec: number; toSec: number } | null {
	let fromSec = Number.POSITIVE_INFINITY;
	let toSec = Number.NEGATIVE_INFINITY;
	for (const event of placed) {
		if (!timesMs.has(event.timeMs)) continue;
		fromSec = Math.min(fromSec, event.rulerSec);
		toSec = Math.max(toSec, event.rulerSec);
	}
	return fromSec <= toSec ? { fromSec, toSec } : null;
}
