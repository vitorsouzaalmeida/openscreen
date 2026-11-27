// Reading and writing the key press sidecar (`<videoPath>.keys.json`).
//
// Node-pure, like `electron/media/cursorSidecar.ts` and for the same reason: no `electron`
// import, so the agent tools and the tests can read a sidecar without the app running.

import fs from "node:fs/promises";
import {
	KEY_RECORDING_SUFFIX,
	type KeyRecordingData,
	parseKeyRecording,
} from "../../src/lib/keystrokes/keyRecording";
import { findMediaLinksByFingerprint } from "../media/mediaLinksRegistry";

const CURSOR_SUFFIX = ".cursor.json";

export function keySidecarPath(videoPath: string): string {
	return `${videoPath}${KEY_RECORDING_SUFFIX}`;
}

async function readAt(sidecarPath: string): Promise<KeyRecordingData | null> {
	try {
		return parseKeyRecording(JSON.parse(await fs.readFile(sidecarPath, "utf-8")));
	} catch {
		return null;
	}
}

/**
 * The key recording of a take, or `null` when it has none. Looks beside the video first. A
 * take that was moved or imported is found through the media-links registry: its cursor
 * sidecar is registered there, and the key sidecar was written next to that one.
 */
export async function readKeySidecar(
	videoPath: string,
	options: { recordingsDir?: string } = {},
): Promise<KeyRecordingData | null> {
	const beside = await readAt(keySidecarPath(videoPath));
	if (beside) return beside;
	if (!options.recordingsDir) return null;
	try {
		const links = await findMediaLinksByFingerprint(options.recordingsDir, videoPath);
		const cursorPath = links?.cursorTelemetryPath;
		if (cursorPath?.endsWith(CURSOR_SUFFIX)) {
			return readAt(`${cursorPath.slice(0, -CURSOR_SUFFIX.length)}${KEY_RECORDING_SUFFIX}`);
		}
	} catch (error) {
		console.warn("[media-links] fingerprint lookup failed for key telemetry:", error);
	}
	return null;
}

export async function writeKeySidecar(videoPath: string, recording: KeyRecordingData) {
	await fs.writeFile(keySidecarPath(videoPath), JSON.stringify(recording, null, 2), "utf-8");
}

export async function removeKeySidecar(videoPath: string) {
	await fs.rm(keySidecarPath(videoPath), { force: true });
}
