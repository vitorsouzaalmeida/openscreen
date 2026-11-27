// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURSOR_THEMES } from "@/lib/cursor/cursorThemes";
import { CursorPane } from "./RightPanes";

function stubStorage() {
	const store = new Map<string, string>();
	const localStorage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
		key: (index: number) => [...store.keys()][index] ?? null,
		get length() {
			return store.size;
		},
	};
	Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage });
}

beforeEach(() => {
	stubStorage();
});

afterEach(() => {
	cleanup();
});

describe("CursorPane theme picker", () => {
	it("shows the original cursor themes beside the default", () => {
		expect(CURSOR_THEMES).toHaveLength(6);
		render(<CursorPane />);
		expect(screen.getByRole("button", { name: "Default" })).toBeTruthy();
		for (const theme of CURSOR_THEMES) {
			const button = screen.getByRole("button", { name: theme.name });
			expect(button.querySelectorAll("img")).toHaveLength(1);
		}
	});
});
