import i18next, { type ResourceLanguage } from "i18next";
import { I18N_NAMESPACES, type I18nNamespace } from "./config";

// The app is English-only. The strings still live in one JSON catalog per namespace
// rather than inline, so copy is edited in one place and `npm run i18n:check` can verify
// every key the code asks for.
const LANGUAGE = "en";

const modules = import.meta.glob("./locales/en/*.json", {
	eager: true,
	import: "default",
}) as Record<string, unknown>;

const catalog: Record<string, unknown> = {};
for (const [path, mod] of Object.entries(modules)) {
	const namespace = path.replace("./locales/en/", "").replace(".json", "");
	catalog[namespace] = mod;
}

const missing = I18N_NAMESPACES.filter((ns) => !catalog[ns]);
if (missing.length > 0) {
	console.error("[i18n] Missing namespace files:", missing.join(", "));
}

await i18next.init({
	lng: LANGUAGE,
	fallbackLng: LANGUAGE,
	defaultNS: "common",
	resources: { [LANGUAGE]: catalog as ResourceLanguage },
	interpolation: { escapeValue: false },
	// A non-leaf key would otherwise render i18next's English developer message
	// ("key 'x' returned an object instead of string") straight into the UI.
	// Returning undefined keeps the old loader's behaviour: fall through to the
	// `namespace.key` marker.
	returnedObjectHandler: () => undefined,
});

export function translate(
	namespace: I18nNamespace,
	key: string,
	vars?: Record<string, string | number>,
): string {
	if (i18next.exists(key, { ns: namespace })) {
		const result = i18next.t(key, { ns: namespace, ...vars });
		if (typeof result === "string") return result;
	}
	return `${namespace}.${key}`;
}
