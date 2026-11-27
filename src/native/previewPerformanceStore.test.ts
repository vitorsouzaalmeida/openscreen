// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PREFS_KEY = "openscreen_user_preferences";

/** The store reads the saved preferences once, on first use: each test takes a fresh module. */
async function freshStore() {
	vi.resetModules();
	return import("./previewPerformanceStore");
}

describe("previewPerformanceStore", () => {
	beforeEach(() => {
		const store = new Map<string, string>();
		Object.defineProperty(globalThis, "localStorage", {
			value: {
				getItem: (key: string) => store.get(key) ?? null,
				setItem: (key: string, value: string) => {
					store.set(key, String(value));
				},
			},
			configurable: true,
		});
	});

	it("starts from the automatic frame rate at full resolution", async () => {
		const { getPreviewPerformance } = await freshStore();

		expect(getPreviewPerformance()).toEqual({ frameRate: "auto", resolution: 1 });
	});

	it("starts from what was saved", async () => {
		localStorage.setItem(
			PREFS_KEY,
			JSON.stringify({ previewFrameRate: 60, previewResolution: 0.5 }),
		);
		const { getPreviewPerformance } = await freshStore();

		expect(getPreviewPerformance()).toEqual({ frameRate: 60, resolution: 0.5 });
	});

	it("saves a change, and keeps the field it did not touch", async () => {
		const { getPreviewPerformance, setPreviewPerformance } = await freshStore();

		setPreviewPerformance({ frameRate: 60 });
		setPreviewPerformance({ resolution: 0.75 });

		expect(getPreviewPerformance()).toEqual({ frameRate: 60, resolution: 0.75 });
		expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}")).toMatchObject({
			previewFrameRate: 60,
			previewResolution: 0.75,
		});
	});

	it("hands a change to a mounted reader, and none when nothing changed", async () => {
		const { setPreviewPerformance, usePreviewPerformance } = await freshStore();
		let renders = 0;
		const { result } = renderHook(() => {
			renders++;
			return usePreviewPerformance();
		});

		act(() => setPreviewPerformance({ resolution: 0.5 }));
		expect(result.current).toEqual({ frameRate: "auto", resolution: 0.5 });

		const before = renders;
		act(() => setPreviewPerformance({ resolution: 0.5 }));
		expect(renders).toBe(before);
	});
});
