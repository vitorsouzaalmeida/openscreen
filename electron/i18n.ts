// Strings for the Electron main process (menus, tray, dialogs).
// Reads the same English catalog as the renderer.

import commonEn from "../src/i18n/locales/en/common.json";
import dialogsEn from "../src/i18n/locales/en/dialogs.json";

type Namespace = "common" | "dialogs";

const messages: Record<Namespace, unknown> = { common: commonEn, dialogs: dialogsEn };

function getMessageValue(obj: unknown, dotPath: string): string | undefined {
	const keys = dotPath.split(".");
	let current: unknown = obj;
	for (const key of keys) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return typeof current === "string" ? current : undefined;
}

function interpolate(str: string, vars?: Record<string, string | number>): string {
	if (!vars) return str;
	return str.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? `{{${key}}}`));
}

export function mainT(
	namespace: Namespace,
	key: string,
	vars?: Record<string, string | number>,
): string {
	const value = getMessageValue(messages[namespace], key);
	if (value == null) return `${namespace}.${key}`;
	return interpolate(value, vars);
}
