// The key-sounds side of a take: ask the timing service to listen while the take runs, and
// turn what it heard into the take's `.keys.json`.
//
// Every method is safe to call when key sounds are off, the service is not installed, or the
// user declined its prompt: a take records exactly as it would have without this file.

import {
	buildKeyRecording,
	type KeyPauseRange,
	type KeyRecordingData,
} from "../../src/lib/keystrokes/keyRecording";
import { removeKeySidecar, writeKeySidecar } from "./keySidecar";
import { KEYTICK_PROVIDER, type KeytickAnswer, KeytickClient } from "./keytickClient";

/** How long a take waits on the service's prompt before starting without key timing. */
const BEGIN_TIMEOUT_MS = 60_000;

export interface KeySoundsStatus {
	/** Key capture exists on this platform at all. */
	supported: boolean;
	/** The timing service is installed (its socket exists). */
	installed: boolean;
}

export class KeySoundsRecording {
	constructor(
		private readonly client: KeytickClient = new KeytickClient(),
		private readonly platform: NodeJS.Platform = process.platform,
	) {}

	status(): KeySoundsStatus {
		return { supported: this.platform === "linux", installed: this.client.isInstalled() };
	}

	/**
	 * Raises the service's password prompt if this app session has not answered it yet.
	 * Call it while no take is running, so the prompt is never recorded.
	 */
	authorize(): Promise<KeytickAnswer> {
		return this.client.authorize();
	}

	/**
	 * Starts listening for the take about to begin. Call it BEFORE the capture is armed: a
	 * connection that still needs its prompt answered raises it here, ahead of frame 0. Keys
	 * pressed before the recording's zero are dropped when the take is saved.
	 */
	async begin(enabled: boolean): Promise<KeytickAnswer | "off"> {
		if (!enabled) return "off";
		const starting = this.client.start();
		let timer: NodeJS.Timeout | undefined;
		const answer = await Promise.race([
			starting,
			new Promise<"timeout">((resolve) => {
				timer = setTimeout(() => resolve("timeout"), BEGIN_TIMEOUT_MS);
			}),
		]);
		clearTimeout(timer);
		if (answer === "timeout") {
			// A prompt nobody answers must not hold the take. If the answer does come, the
			// take has started without it, so the listening it would start is stopped.
			void starting.then((late) => {
				if (late === "ok") this.client.stop();
			});
			console.info("[key-sounds] not recording key timing for this take: prompt unanswered");
			return "unavailable";
		}
		if (answer !== "ok") {
			console.info(`[key-sounds] not recording key timing for this take: ${answer}`);
		}
		return answer;
	}

	/**
	 * Stops listening and writes the take's key sidecar. Returns the recording, or `null`
	 * when nothing was captured (and nothing was written).
	 */
	async finish(
		videoPath: string,
		recordingStartMs: number,
		pauseRanges: KeyPauseRange[],
	): Promise<KeyRecordingData | null> {
		const events = this.client.stop();
		if (events.length === 0 || recordingStartMs <= 0) return null;
		const recording = buildKeyRecording(events, recordingStartMs, pauseRanges, KEYTICK_PROVIDER);
		if (recording.samples.length === 0) return null;
		await writeKeySidecar(videoPath, recording);
		return recording;
	}

	/** Stops listening and throws away what was heard: a discarded or failed take. */
	async cancel(videoPath?: string | null) {
		this.client.stop();
		if (videoPath) await removeKeySidecar(videoPath);
	}

	dispose() {
		this.client.dispose();
	}
}
