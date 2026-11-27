import { memo, useMemo } from "react";
import styles from "./EditorShellV4.module.css";

/** Past this many, neighbouring ticks share a pixel anyway: draw one per bucket instead. */
const MAX_TICKS = 600;

/**
 * Where on a clip card each recorded key press falls, as fractions 0..1 of the card. Only the
 * presses inside the clip's own source window are drawn, and presses closer together than a
 * tick is wide collapse into one.
 */
export function keyTickPositions(
	pressTimesSec: readonly number[],
	sourceStartSec: number,
	sourceEndSec: number,
): number[] {
	const span = sourceEndSec - sourceStartSec;
	if (!(span > 0)) return [];
	const buckets = new Set<number>();
	for (const timeSec of pressTimesSec) {
		if (timeSec < sourceStartSec || timeSec >= sourceEndSec) continue;
		buckets.add(Math.round(((timeSec - sourceStartSec) / span) * MAX_TICKS));
	}
	return [...buckets].sort((a, b) => a - b).map((bucket) => bucket / MAX_TICKS);
}

/**
 * The take's key presses, drawn as ticks along the foot of its clip card: the keyboard's
 * timeline. Says when something was typed, never what.
 */
export const ClipKeyTicks = memo(function ClipKeyTicks({
	pressTimesSec,
	sourceStartSec,
	sourceEndSec,
}: {
	pressTimesSec: readonly number[];
	sourceStartSec: number;
	sourceEndSec: number;
}) {
	const positions = useMemo(
		() => keyTickPositions(pressTimesSec, sourceStartSec, sourceEndSec),
		[pressTimesSec, sourceStartSec, sourceEndSec],
	);
	if (positions.length === 0) return null;
	return (
		<svg
			className={styles.tlClipKeyTicks}
			data-testid="clip-key-ticks"
			viewBox="0 0 1 1"
			preserveAspectRatio="none"
			aria-hidden
		>
			{positions.map((x) => (
				<line key={x} x1={x} x2={x} y1={0} y2={1} vectorEffect="non-scaling-stroke" />
			))}
		</svg>
	);
});
