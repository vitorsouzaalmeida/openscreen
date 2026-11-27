import { Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { useScopedT } from "@/contexts/I18nContext";
import { PREVIEW_FRAME_RATES, PREVIEW_RESOLUTIONS } from "@/lib/userPreferences";
import { setPreviewPerformance, usePreviewPerformance } from "@/native/previewPerformanceStore";
import styles from "./NewEditorShell.module.css";
import { ChoiceRow } from "./RightPanes";

/** The playback bar's gear: how fast and how large this machine draws the preview. Saved with
 *  the app's preferences, not with the project, and the export never reads it. */
export function PreviewSettingsPopover() {
	const t = useScopedT("editor");
	const { frameRate, resolution } = usePreviewPerformance();
	const label = t("transport.previewSettings");
	return (
		<Popover>
			<Tooltip content={label}>
				<PopoverTrigger asChild>
					<button type="button" className={styles.tbtn} aria-label={label}>
						<Settings2 size={16} />
					</button>
				</PopoverTrigger>
			</Tooltip>
			<PopoverContent align="start" sideOffset={6} className="w-64">
				<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
					<div>
						<span className={styles.groupLabel}>{t("transport.previewFrameRate")}</span>
						<ChoiceRow
							label={t("transport.previewFrameRate")}
							options={PREVIEW_FRAME_RATES.map((value) => ({
								value,
								label: value === "auto" ? t("transport.previewFrameRateAuto") : String(value),
							}))}
							value={frameRate}
							onChange={(next) => setPreviewPerformance({ frameRate: next })}
						/>
					</div>
					<div>
						<span className={styles.groupLabel}>{t("transport.previewResolution")}</span>
						<ChoiceRow
							label={t("transport.previewResolution")}
							options={PREVIEW_RESOLUTIONS.map((value) => ({
								value,
								label: value === 1 ? t("transport.previewResolutionFull") : `${value * 100}%`,
							}))}
							value={resolution}
							onChange={(next) => setPreviewPerformance({ resolution: next })}
						/>
					</div>
					<p className={styles.hint}>{t("transport.previewSettingsHint")}</p>
				</div>
			</PopoverContent>
		</Popover>
	);
}
