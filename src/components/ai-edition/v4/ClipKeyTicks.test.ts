import { describe, expect, it } from "vitest";
import { keyTickPositions } from "./ClipKeyTicks";

describe("keyTickPositions", () => {
	it("places a press by its share of the clip's source window", () => {
		expect(keyTickPositions([12, 15], 10, 20)).toEqual([0.2, 0.5]);
	});

	it("leaves out presses the clip does not show", () => {
		expect(keyTickPositions([5, 10, 19.9, 20, 30], 10, 20)).toHaveLength(2);
	});

	it("draws presses that share a pixel once", () => {
		expect(keyTickPositions([10.001, 10.002, 10.003], 10, 20)).toHaveLength(1);
	});

	it("is empty for a clip with no length", () => {
		expect(keyTickPositions([1], 5, 5)).toEqual([]);
	});
});
