import { useCallback, useEffect, useRef, useState } from "react";

export interface KeySoundsControl {
	/** Key capture exists on this platform. Where false, the toggle is not offered at all. */
	supported: boolean;
	/** The key timing service is installed. Where false, turning the toggle on cannot work. */
	installed: boolean;
	enabled: boolean;
	toggle: () => void;
}

/**
 * Whether key sounds can be recorded here, and the main process's word when a toggle it could
 * not honour was turned back off (`onUnavailable`), so the caller can tell the user.
 */
export function useKeySoundsStatus(
	onUnavailable?: (reason: "denied" | "unavailable") => void,
): Pick<KeySoundsControl, "supported" | "installed"> {
	const [status, setStatus] = useState({ supported: false, installed: false });
	const onUnavailableRef = useRef(onUnavailable);
	onUnavailableRef.current = onUnavailable;

	useEffect(() => {
		let cancelled = false;
		const api = window.electronAPI;
		const refresh = () => {
			void api
				?.getKeySoundsStatus?.()
				.then((next) => {
					if (!cancelled && next) setStatus(next);
				})
				.catch(() => undefined);
		};
		refresh();
		const off = api?.onKeySoundsUnavailable?.((reason) => {
			if (cancelled) return;
			// The socket may have appeared or gone since the first read.
			refresh();
			onUnavailableRef.current?.(reason);
		});
		return () => {
			cancelled = true;
			off?.();
		};
	}, []);

	return status;
}

/**
 * The "Key sounds" recording option for a window that does not already hold the recording
 * prefs (the recording bar). The editor's Record mode holds them, and pairs
 * `useKeySoundsStatus` with its own copy instead.
 *
 * The preference lives with the other recording prefs in the main process. Turning it on makes
 * the main process ask the key timing service for authorization (a system password prompt, once
 * per app session); when that fails the main process turns the preference back off and says why.
 */
export function useKeySounds(
	onUnavailable?: (reason: "denied" | "unavailable") => void,
): KeySoundsControl {
	const status = useKeySoundsStatus(onUnavailable);
	const [enabled, setEnabled] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const api = window.electronAPI;
		void api
			?.getRecordingPrefs?.()
			.then((prefs) => {
				if (!cancelled && prefs) setEnabled(Boolean(prefs.keySoundsEnabled));
			})
			.catch(() => undefined);
		const off = api?.onRecordingPrefsChanged?.((prefs) => {
			if (!cancelled) setEnabled(Boolean(prefs.keySoundsEnabled));
		});
		return () => {
			cancelled = true;
			off?.();
		};
	}, []);

	const toggle = useCallback(() => {
		const next = !enabled;
		setEnabled(next);
		void window.electronAPI?.setRecordingPrefs?.({ keySoundsEnabled: next }).catch((error) => {
			console.warn("Failed to persist the key sounds preference:", error);
			setEnabled(!next);
		});
	}, [enabled]);

	return { ...status, enabled, toggle };
}
