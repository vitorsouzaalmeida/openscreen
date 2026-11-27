// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { glidePlayhead, PLAYHEAD_GLIDE_MIN_PX, PLAYHEAD_GLIDE_MS } from "./playheadGlide";

/** A playhead inside a 1000px-wide track, with a stand-in for Web Animations (jsdom has none). */
function playhead() {
	const track = document.createElement("div");
	Object.defineProperty(track, "clientWidth", { value: 1000 });
	const el = document.createElement("div");
	track.appendChild(el);
	const animation = { cancel: vi.fn() } as unknown as Animation;
	const animate = vi.fn(() => animation);
	el.animate = animate as unknown as HTMLElement["animate"];
	return { el, animate, animation };
}

describe("glidePlayhead", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("slides from where the line was to where it now is, with no overshoot", () => {
		const { el, animate, animation } = playhead();
		// 20% → 50% of 1000px: the line starts 300px to the left of its new place.
		expect(glidePlayhead(el, 20, 50)).toBe(animation);
		expect(animate).toHaveBeenCalledWith(
			[{ transform: "translateX(-300px)" }, { transform: "none" }],
			{ duration: PLAYHEAD_GLIDE_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
		);
	});

	it("starts to the right of its target when it jumps back", () => {
		const { el, animate } = playhead();
		glidePlayhead(el, 80, 10);
		expect(animate).toHaveBeenCalledWith(
			[{ transform: "translateX(700px)" }, { transform: "none" }],
			expect.anything(),
		);
	});

	it("does not animate a move too short to see, such as a frame step", () => {
		const { el, animate } = playhead();
		const justUnder = ((PLAYHEAD_GLIDE_MIN_PX - 1) / 1000) * 100;
		expect(glidePlayhead(el, 50, 50 + justUnder)).toBeNull();
		expect(animate).not.toHaveBeenCalled();
	});

	it("does not animate under reduced motion", () => {
		vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
		const { el, animate } = playhead();
		expect(glidePlayhead(el, 0, 50)).toBeNull();
		expect(animate).not.toHaveBeenCalled();
	});

	it("returns null where Web Animations do not exist", () => {
		const track = document.createElement("div");
		const el = document.createElement("div");
		track.appendChild(el);
		expect(glidePlayhead(el, 0, 50)).toBeNull();
	});
});
