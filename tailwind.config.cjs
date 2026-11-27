/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	// No colour names here on purpose: the palette is src/styles/design-tokens.css, read
	// through arbitrary values (`bg-[var(--surface-2)]`).
	theme: {
		extend: {
			keyframes: {
				"record-pulse": {
					"0%, 100%": { boxShadow: "0 0 8px rgba(239, 68, 68, 0.15)" },
					"50%": { boxShadow: "0 0 16px rgba(239, 68, 68, 0.4)" },
				},
				"mic-panel-in": {
					from: { opacity: "0", transform: "translateY(4px)" },
					to: { opacity: "1", transform: "translateY(0)" },
				},
			},
			animation: {
				"record-pulse": "record-pulse 1.5s ease-in-out infinite",
				"mic-panel-in": "mic-panel-in 0.15s ease-out",
			},
			boxShadow: {
				"hud-bar": "0 2px 16px rgba(0, 0, 0, 0.25), 0 0 40px rgba(100, 80, 200, 0.08)",
				"mic-panel": "0 2px 12px rgba(0, 0, 0, 0.2), 0 0 30px rgba(100, 80, 200, 0.06)",
			},
		},
	},
	plugins: [require("tailwindcss-animate")],
};
