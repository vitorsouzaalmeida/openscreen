// The "key presses" row in the cursor pane, beside "mouse clicks" and built like it: a setting
// for the whole take (see src/lib/ai-edition/keySound.ts). The presses themselves are on the
// timeline's Keys lane, which reads them through `useTakeInputEvents`.

import { useEffect, useState } from "react";
import { clickTakeOf } from "@/lib/ai-edition/clickSound";
import { ensureKeySamplePaths, type KeyCue, loadKeyCues } from "@/lib/ai-edition/keySound";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";

export function useKeySoundCues() {
	const document = useProjectStore((s) => s.document);
	const takePath = clickTakeOf(document)?.originalPath ?? null;
	// The row is offered only once the take is known to hold key timing: reading its cues is
	// what says so, and it is the same one-shot read the hits come from.
	const [cues, setCues] = useState<KeyCue[] | null>(null);
	useEffect(() => {
		let current = true;
		setCues(null);
		if (takePath) void loadKeyCues(takePath).then((loaded) => current && setCues(loaded));
		return () => {
			current = false;
		};
	}, [takePath]);

	// The sound is on by default, so the samples the export needs are staged as soon as a take
	// turns out to have keys, not on a toggle the user may never touch.
	const hasKeys = Boolean(cues?.length);
	useEffect(() => {
		if (hasKeys) void ensureKeySamplePaths().catch(() => null);
	}, [hasKeys]);

	return {
		hasKeys,
		prepare: async () => {
			const take = clickTakeOf(document)?.originalPath;
			if (!take) return;
			await Promise.all([loadKeyCues(take), ensureKeySamplePaths().catch(() => null)]);
		},
	};
}
