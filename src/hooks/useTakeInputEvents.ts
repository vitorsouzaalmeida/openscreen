// The clicks and key presses of the project's take, for the timeline's Clicks and Keys lanes.
//
// The same events the click sound and the key sound are laid out from (clickSound.ts,
// keySound.ts), one entry per PRESS and each with whether its sound is left out
// (inputSounds.ts). The clicks are the ones the document draws, cursor overrides included, so
// the lane shows exactly the clicks that can sound.

import { useEffect, useMemo, useState } from "react";
import { clickTakeOf, loadClickTelemetry, takeClickCues } from "@/lib/ai-edition/clickSound";
import { mutedInputSoundTimes } from "@/lib/ai-edition/inputSounds";
import { type KeyCue, loadKeyCues } from "@/lib/ai-edition/keySound";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";

export interface TakeInputEvent {
	/** The recording millisecond of the press: what names the event, and what a mute stores. */
	timeMs: number;
	/** Its sound is left out of the preview and the export. */
	muted: boolean;
}

const NONE: TakeInputEvent[] = [];

export function useTakeInputEvents(): {
	/** The asset the events belong to: the project's take. */
	takeAssetId: string | null;
	clicks: TakeInputEvent[];
	keys: TakeInputEvent[];
} {
	const document = useProjectStore((s) => s.document);
	const take = clickTakeOf(document);
	const takePath = take?.originalPath ?? null;
	// Which take's recorded pointer has been read. Until it has, the document's own clicks
	// (its overrides') are not the whole answer, and showing them alone would flash.
	const [pointerRead, setPointerRead] = useState<string | null>(null);
	const [keyCues, setKeyCues] = useState<{ takePath: string; cues: KeyCue[] } | null>(null);
	useEffect(() => {
		if (!takePath) return;
		let current = true;
		void loadClickTelemetry(takePath).then(() => current && setPointerRead(takePath));
		void loadKeyCues(takePath).then((cues) => current && setKeyCues({ takePath, cues }));
		return () => {
			current = false;
		};
	}, [takePath]);

	const clicks = useMemo(() => {
		if (!document || !take || pointerRead !== take.originalPath) return NONE;
		const muted = mutedInputSoundTimes(document, take.id, "click");
		const events: TakeInputEvent[] = [];
		let last = Number.NaN;
		// One click is a press, perhaps a second tap, and a release: all three carry its `clickMs`.
		for (const cue of takeClickCues(document, take)) {
			if (cue.release || cue.clickMs === last) continue;
			last = cue.clickMs;
			events.push({ timeMs: cue.clickMs, muted: muted.has(cue.clickMs) });
		}
		return events.length > 0 ? events : NONE;
	}, [document, take, pointerRead]);

	const keys = useMemo(() => {
		if (!document || !take || keyCues?.takePath !== take.originalPath) return NONE;
		const muted = mutedInputSoundTimes(document, take.id, "key");
		const events = keyCues.cues
			.filter((cue) => !cue.release)
			.map((cue) => ({ timeMs: cue.pressMs, muted: muted.has(cue.pressMs) }));
		return events.length > 0 ? events : NONE;
	}, [document, take, keyCues]);

	return { takeAssetId: take?.id ?? null, clicks, keys };
}
