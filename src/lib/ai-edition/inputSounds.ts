// Which clicks and key presses of a take stay silent.
//
// The click sound and the key sound are laid out from the take's recorded events every time a
// scene is built (clickSound.ts, keySound.ts). Leaving one out is therefore a filter on that
// list, kept in the document (`mutedInputSounds`): the event itself is untouched, so a muted
// click still bounces, still carries its zoom and still shows on the timeline, where the same
// action gives its sound back.
//
// An event is named by its asset and the recording millisecond of its PRESS. Both sidecars are
// read-only, so that number is stable; a click an override adds is named the same way and
// simply stops matching if the override moves it.
//
// Pure: no fs, no IPC, no store.

import type { AxcutDocument, AxcutMutedInputSound } from "./schema";

export type InputSoundKind = AxcutMutedInputSound["kind"];

type MuteDocument = Pick<AxcutDocument, "mutedInputSounds">;

const NONE: ReadonlySet<number> = new Set();
// The list is read on every scene build, and a document is replaced, never mutated: one index
// per list instance is exact for as long as that instance lives.
const indexByList = new WeakMap<readonly AxcutMutedInputSound[], Map<string, Set<number>>>();

/** The recording milliseconds of the presses of this kind that stay silent on this asset. */
export function mutedInputSoundTimes(
	document: MuteDocument | null | undefined,
	assetId: string | null | undefined,
	kind: InputSoundKind,
): ReadonlySet<number> {
	const list = document?.mutedInputSounds;
	if (!list?.length || !assetId) return NONE;
	let index = indexByList.get(list);
	if (!index) {
		index = new Map();
		for (const entry of list) {
			const key = `${entry.kind}\n${entry.assetId}`;
			const times = index.get(key) ?? new Set<number>();
			times.add(entry.timeMs);
			index.set(key, times);
		}
		indexByList.set(list, index);
	}
	return index.get(`${kind}\n${assetId}`) ?? NONE;
}

/**
 * The document with these presses silenced, or given their sound back. An empty list leaves no
 * key behind, so a project that never muted anything saves exactly as it did before.
 */
export function setInputSoundsMuted<D extends MuteDocument>(
	document: D,
	assetId: string,
	kind: InputSoundKind,
	timesMs: readonly number[],
	muted: boolean,
): D {
	const named = new Set(timesMs);
	const others = (document.mutedInputSounds ?? []).filter(
		(entry) => !(entry.assetId === assetId && entry.kind === kind && named.has(entry.timeMs)),
	);
	const next = muted
		? [...others, ...[...named].map((timeMs) => ({ assetId, kind, timeMs }))]
		: others;
	const { mutedInputSounds: _dropped, ...rest } = document;
	return (next.length > 0 ? { ...rest, mutedInputSounds: next } : rest) as D;
}
