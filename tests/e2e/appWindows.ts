import type { ElectronApplication, Page } from "@playwright/test";

/**
 * The app's window of the given `windowType`, once it has navigated there.
 *
 * Reading the URL inside `app.waitForEvent("window")`, or straight after
 * `app.firstWindow()`, only worked up to Electron 41, which reported a window with its
 * final URL. Electron 45 reports it before it navigates, with an empty URL: the predicate
 * never matches, and a `domcontentloaded` wait settles on the blank document. Polling the
 * window list also finds a window that opened before the caller started waiting.
 */
export async function waitForAppWindow(
	app: ElectronApplication,
	windowType: string,
	timeout = 15_000,
): Promise<Page> {
	const marker = `windowType=${windowType}`;
	const deadline = Date.now() + timeout;
	for (;;) {
		const match = app.windows().find((w) => w.url().includes(marker));
		if (match) return match;
		if (Date.now() > deadline) {
			throw new Error(`No ${windowType} window within ${timeout}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}
