// How the editor's preview is delivered on this machine: how often a frame is taken from the
// native compositor, and how large it is rendered. The playback bar's popover writes it and the
// preview's hook reads it, two components with no common parent worth a prop, hence a store.
// It never reaches the document or the export: what a machine can show says nothing about the
// project.

import { useSyncExternalStore } from "react";
import {
	DEFAULT_PREFS,
	loadUserPreferences,
	type PreviewFrameRate,
	type PreviewResolution,
	saveUserPreferences,
} from "@/lib/userPreferences";

export interface PreviewPerformance {
	frameRate: PreviewFrameRate;
	resolution: PreviewResolution;
}

const DEFAULT_PREVIEW_PERFORMANCE: PreviewPerformance = {
	frameRate: DEFAULT_PREFS.previewFrameRate,
	resolution: DEFAULT_PREFS.previewResolution,
};

/** `null` until first read: the saved preferences are loaded then, not at import. */
let current: PreviewPerformance | null = null;
const listeners = new Set<() => void>();

export function getPreviewPerformance(): PreviewPerformance {
	if (!current) {
		const prefs = loadUserPreferences();
		current = { frameRate: prefs.previewFrameRate, resolution: prefs.previewResolution };
	}
	return current;
}

/** Applies the change to the running preview and saves it for the next launch. */
export function setPreviewPerformance(patch: Partial<PreviewPerformance>): void {
	const previous = getPreviewPerformance();
	const next = { ...previous, ...patch };
	if (next.frameRate === previous.frameRate && next.resolution === previous.resolution) {
		return;
	}
	current = next;
	saveUserPreferences({ previewFrameRate: next.frameRate, previewResolution: next.resolution });
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function usePreviewPerformance(): PreviewPerformance {
	return useSyncExternalStore(subscribe, getPreviewPerformance, () => DEFAULT_PREVIEW_PERFORMANCE);
}
