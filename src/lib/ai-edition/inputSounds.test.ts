import { describe, expect, it } from "vitest";
import { mutedInputSoundTimes, setInputSoundsMuted } from "./inputSounds";
import type { AxcutDocument } from "./schema";

/** A document that has silenced nothing yet. */
const empty: Pick<AxcutDocument, "mutedInputSounds"> = {};

describe("setInputSoundsMuted", () => {
	it("silences the presses named, once each, and leaves the others alone", () => {
		const muted = setInputSoundsMuted(empty, "asset_1", "click", [1000, 2000, 1000], true);
		expect(muted.mutedInputSounds).toEqual([
			{ assetId: "asset_1", kind: "click", timeMs: 1000 },
			{ assetId: "asset_1", kind: "click", timeMs: 2000 },
		]);
		// Silencing one again does not store it twice.
		const again = setInputSoundsMuted(muted, "asset_1", "click", [2000], true);
		expect(again.mutedInputSounds).toHaveLength(2);
	});

	it("gives a sound back, and leaves no empty list behind", () => {
		const muted = setInputSoundsMuted(empty, "asset_1", "key", [500, 900], true);
		const one = setInputSoundsMuted(muted, "asset_1", "key", [500], false);
		expect(one.mutedInputSounds).toEqual([{ assetId: "asset_1", kind: "key", timeMs: 900 }]);
		const none = setInputSoundsMuted(one, "asset_1", "key", [900], false);
		expect("mutedInputSounds" in none).toBe(false);
	});

	it("keeps clicks and keys, and each asset, apart", () => {
		let document = setInputSoundsMuted(empty, "asset_1", "click", [1000], true);
		document = setInputSoundsMuted(document, "asset_1", "key", [1000], true);
		document = setInputSoundsMuted(document, "asset_2", "click", [1000], true);
		// The same millisecond three times over: only the click of asset_1 gets its sound back.
		document = setInputSoundsMuted(document, "asset_1", "click", [1000], false);
		expect(document.mutedInputSounds).toEqual([
			{ assetId: "asset_1", kind: "key", timeMs: 1000 },
			{ assetId: "asset_2", kind: "click", timeMs: 1000 },
		]);
	});

	it("keeps the rest of the document", () => {
		const document = { title: "kept", mutedInputSounds: undefined };
		expect(setInputSoundsMuted(document, "asset_1", "click", [1], true).title).toBe("kept");
	});
});

describe("mutedInputSoundTimes", () => {
	const document = {
		mutedInputSounds: [
			{ assetId: "asset_1", kind: "click" as const, timeMs: 1000 },
			{ assetId: "asset_1", kind: "key" as const, timeMs: 2000 },
			{ assetId: "asset_2", kind: "click" as const, timeMs: 3000 },
		],
	};

	it("answers for one asset and one kind", () => {
		expect([...mutedInputSoundTimes(document, "asset_1", "click")]).toEqual([1000]);
		expect([...mutedInputSoundTimes(document, "asset_1", "key")]).toEqual([2000]);
		expect([...mutedInputSoundTimes(document, "asset_2", "click")]).toEqual([3000]);
	});

	it("is empty for a document that silenced nothing, and for no asset", () => {
		expect(mutedInputSoundTimes({}, "asset_1", "click").size).toBe(0);
		expect(mutedInputSoundTimes(null, "asset_1", "click").size).toBe(0);
		expect(mutedInputSoundTimes(document, null, "click").size).toBe(0);
		expect(mutedInputSoundTimes(document, "asset_9", "click").size).toBe(0);
	});
});
