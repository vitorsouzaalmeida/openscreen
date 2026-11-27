export const I18N_NAMESPACES = [
	"common",
	"dialogs",
	"editor",
	"launch",
	"settings",
	"shortcuts",
	"timeline",
] as const;

export type I18nNamespace = (typeof I18N_NAMESPACES)[number];
