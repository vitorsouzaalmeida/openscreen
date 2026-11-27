import type { CSSProperties } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { useScopedT } from "@/contexts/I18nContext";
import { LAYOUT_PRESETS, type LayoutPreset } from "@/lib/layoutTypes";
import styles from "./Layouts.module.css";

export function LayoutPicker({
	value,
	hasCamera,
	onSelect,
	disabled = false,
	iconOnly = false,
	label,
}: {
	value: LayoutPreset;
	hasCamera: boolean;
	onSelect: (preset: LayoutPreset) => void;
	disabled?: boolean;
	iconOnly?: boolean;
	label?: string;
}) {
	const t = useScopedT("timeline");
	// The grid is 3 wide with labels and 5 wide as icons (Layouts.module.css); the selection
	// plate (`.os-slides`, index.css) needs the same numbers to find the pressed cell.
	const cols = iconOnly ? 5 : 3;
	const selected = LAYOUT_PRESETS.indexOf(value);
	return (
		<div
			className={`os-slides ${styles.presets} ${iconOnly ? styles.iconPresets : ""}`}
			role="group"
			aria-label={label ?? t("layouts.title")}
			data-sel={selected < 0 ? "none" : undefined}
			style={
				{
					"--cols": cols,
					"--rows": Math.ceil(LAYOUT_PRESETS.length / cols),
					"--sel-col": Math.max(selected, 0) % cols,
					"--sel-row": Math.floor(Math.max(selected, 0) / cols),
				} as CSSProperties
			}
		>
			{LAYOUT_PRESETS.map((preset) => {
				const name = t(`layouts.${preset}`);
				const unavailable = !hasCamera && preset !== "no-webcam";
				const button = (
					<button
						type="button"
						key={preset}
						className={styles.preset}
						aria-pressed={value === preset}
						aria-label={name}
						disabled={disabled || unavailable}
						title={!iconOnly && unavailable ? t("layouts.noCamera") : undefined}
						onClick={() => onSelect(preset)}
					>
						<span className={styles.mini} data-layout={preset} aria-hidden="true" />
						{!iconOnly && name}
					</button>
				);
				return iconOnly ? (
					<Tooltip key={preset} content={unavailable ? t("layouts.noCamera") : name}>
						{button}
					</Tooltip>
				) : (
					button
				);
			})}
		</div>
	);
}
