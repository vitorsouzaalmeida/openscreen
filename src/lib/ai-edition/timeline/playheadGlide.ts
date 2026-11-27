// The playhead's short glide to a point it jumps to.
//
// A press on the timeline, or a jump made elsewhere (a transcript word, a restart from the
// end), used to teleport the line. It now slides there, briefly, so the eye can follow it.
// It never applies while the line is driven every frame: playback, and the drag of a scrub.
//
// The position itself is still written as before (`left`, in percent, exact at once): the
// glide is a one-shot animation of `transform` from the old place to none, so there is no
// state to clear and nothing a later write has to wait for.

/** Short enough not to slow a seek down, long enough to be seen. */
export const PLAYHEAD_GLIDE_MS = 140;
/** Below this the line has hardly moved (a frame step): gliding it would only blur it. */
export const PLAYHEAD_GLIDE_MIN_PX = 6;
/** Eases out with no overshoot: a time marker that passes its target shows the wrong time. */
const PLAYHEAD_GLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Slides `el` from `fromPct` to `toPct` (percent of its parent's width), where it already
 * is. Returns the animation so a drag that follows can cancel it, or null when there is
 * nothing to animate: too short a move, reduced motion, or no Web Animations (jsdom).
 */
export function glidePlayhead(el: HTMLElement, fromPct: number, toPct: number): Animation | null {
	const track = el.parentElement;
	if (!track || typeof el.animate !== "function") return null;
	const deltaPx = ((fromPct - toPct) / 100) * track.clientWidth;
	if (Math.abs(deltaPx) < PLAYHEAD_GLIDE_MIN_PX) return null;
	if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
	return el.animate([{ transform: `translateX(${deltaPx}px)` }, { transform: "none" }], {
		duration: PLAYHEAD_GLIDE_MS,
		easing: PLAYHEAD_GLIDE_EASING,
	});
}
