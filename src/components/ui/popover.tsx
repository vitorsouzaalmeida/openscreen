"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "@/lib/utils";

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

// forwardRef, like the Dialog parts: on React 18 a plain function component
// cannot receive a ref, so anything that wraps this trigger with its own
// `asChild` — a Tooltip around a popover button, say — fails to anchor and
// warns. The primitive underneath has always forwarded; only this wrapper
// swallowed it.
const PopoverTrigger = React.forwardRef<
	React.ComponentRef<typeof PopoverPrimitive.Trigger>,
	React.ComponentProps<typeof PopoverPrimitive.Trigger>
>(({ ...props }, ref) => (
	<PopoverPrimitive.Trigger ref={ref} data-slot="popover-trigger" {...props} />
));
PopoverTrigger.displayName = "PopoverTrigger";

function PopoverContent({
	className,
	align = "center",
	sideOffset = 4,
	...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				data-slot="popover-content"
				align={align}
				sideOffset={sideOffset}
				className={cn(
					// --surface-2, a step below the selection plate (--surface-hi), so a choice row
					// inside a popover still shows which cell is chosen.
					"z-50 w-72 rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[var(--fg)] shadow-[var(--elev-pop)] outline-none",
					"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
					className,
				)}
				{...props}
			/>
		</PopoverPrimitive.Portal>
	);
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
	return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
