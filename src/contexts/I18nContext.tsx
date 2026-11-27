import { useCallback } from "react";
import type { I18nNamespace } from "@/i18n/config";
import { translate } from "@/i18n/loader";

type TranslateVars = Record<string, string | number>;

/** The app's strings for one namespace of the English catalog (`src/i18n/locales/en`). */
export function useScopedT(namespace: I18nNamespace) {
	return useCallback(
		(key: string, vars?: TranslateVars): string => translate(namespace, key, vars),
		[namespace],
	);
}
