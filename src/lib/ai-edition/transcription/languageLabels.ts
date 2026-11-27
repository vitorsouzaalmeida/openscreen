// Turns a whisper.cpp language code into text a user can read. Shared by
// every "Regenerate as" picker and detected-language pill so they can't
// disagree with each other the way a hand-duplicated label map would.
import {
	TRANSCRIPT_LANGUAGE_CODES,
	type TranscriptLanguageCode,
	type WhisperLanguageCode,
} from "../schema";

/**
 * English fallback name per code, from whisper.cpp's own `g_lang` table.
 * `languageLabel` prefers `Intl.DisplayNames` in the active locale and falls
 * back to this when that can't resolve a name (e.g. an unusual code on an
 * older ICU).
 */
const ENGLISH_NAMES: Record<WhisperLanguageCode, string> = {
	en: "English",
	zh: "Chinese",
	de: "German",
	es: "Spanish",
	ru: "Russian",
	ko: "Korean",
	fr: "French",
	ja: "Japanese",
	pt: "Portuguese",
	tr: "Turkish",
	pl: "Polish",
	ca: "Catalan",
	nl: "Dutch",
	ar: "Arabic",
	sv: "Swedish",
	it: "Italian",
	id: "Indonesian",
	hi: "Hindi",
	fi: "Finnish",
	vi: "Vietnamese",
	he: "Hebrew",
	uk: "Ukrainian",
	el: "Greek",
	ms: "Malay",
	cs: "Czech",
	ro: "Romanian",
	da: "Danish",
	hu: "Hungarian",
	ta: "Tamil",
	no: "Norwegian",
	th: "Thai",
	ur: "Urdu",
	hr: "Croatian",
	bg: "Bulgarian",
	lt: "Lithuanian",
	la: "Latin",
	mi: "Maori",
	ml: "Malayalam",
	cy: "Welsh",
	sk: "Slovak",
	te: "Telugu",
	fa: "Persian",
	lv: "Latvian",
	bn: "Bengali",
	sr: "Serbian",
	az: "Azerbaijani",
	sl: "Slovenian",
	kn: "Kannada",
	et: "Estonian",
	mk: "Macedonian",
	br: "Breton",
	eu: "Basque",
	is: "Icelandic",
	hy: "Armenian",
	ne: "Nepali",
	mn: "Mongolian",
	bs: "Bosnian",
	kk: "Kazakh",
	sq: "Albanian",
	sw: "Swahili",
	gl: "Galician",
	mr: "Marathi",
	pa: "Punjabi",
	si: "Sinhala",
	km: "Khmer",
	sn: "Shona",
	yo: "Yoruba",
	so: "Somali",
	af: "Afrikaans",
	oc: "Occitan",
	ka: "Georgian",
	be: "Belarusian",
	tg: "Tajik",
	sd: "Sindhi",
	gu: "Gujarati",
	am: "Amharic",
	yi: "Yiddish",
	lo: "Lao",
	uz: "Uzbek",
	fo: "Faroese",
	ht: "Haitian Creole",
	ps: "Pashto",
	tk: "Turkmen",
	nn: "Norwegian Nynorsk",
	mt: "Maltese",
	sa: "Sanskrit",
	lb: "Luxembourgish",
	my: "Myanmar",
	bo: "Tibetan",
	tl: "Tagalog",
	mg: "Malagasy",
	as: "Assamese",
	tt: "Tatar",
	haw: "Hawaiian",
	ln: "Lingala",
	ha: "Hausa",
	ba: "Bashkir",
	jw: "Javanese",
	su: "Sundanese",
	yue: "Cantonese",
};

// The UI is English-only, so the names are English ones. Built once; `null` when this
// runtime's ICU data can't build a language `Intl.DisplayNames` (e.g. small-icu), so the
// throwing constructor is paid once and not once per language code.
let displayNames: Intl.DisplayNames | null | undefined;

function englishDisplayNames(): Intl.DisplayNames | null {
	if (displayNames === undefined) {
		try {
			displayNames = new Intl.DisplayNames(["en"], { type: "language" });
		} catch {
			displayNames = null;
		}
	}
	return displayNames;
}

/**
 * English name for a whisper.cpp language code, e.g. "jw" -> "Javanese". Falls back to
 * whisper's own English name (`ENGLISH_NAMES`) when ICU can't resolve one —
 * `Intl.DisplayNames` echoes the input code back rather than throwing when it doesn't
 * recognize it.
 *
 * `code` is typed loosely (not `WhisperLanguageCode`): `AxcutTranscript.language`
 * is `z.string().min(1)`, not validated against the known code list, so a
 * detected-language pill can hand this any non-empty string. Falls back to
 * the raw code itself — never `undefined` — when neither ICU nor
 * `ENGLISH_NAMES` recognizes it.
 */
export function languageLabel(code: string): string {
	try {
		const resolved = englishDisplayNames()?.of(code);
		if (resolved && resolved.toLowerCase() !== code.toLowerCase()) return resolved;
	} catch {
		// Malformed/unsupported subtag for this Intl implementation.
	}
	return ENGLISH_NAMES[code as WhisperLanguageCode] ?? code;
}

export interface LanguageOption {
	code: TranscriptLanguageCode;
	label: string;
}

/**
 * Every language option for a "Regenerate as" picker: "auto" pinned first
 * with the caller's own label for it, the rest sorted by name so a
 * 100-language list is scannable instead of ordered by whisper's internal
 * language id.
 */
export function sortedLanguageOptions(autoLabel: string): LanguageOption[] {
	let compare: (a: string, b: string) => number;
	try {
		compare = new Intl.Collator("en").compare;
	} catch {
		compare = (a, b) => a.localeCompare(b);
	}
	// TRANSCRIPT_LANGUAGE_CODES always starts with "auto" (see its own comment).
	const rest = (TRANSCRIPT_LANGUAGE_CODES.slice(1) as WhisperLanguageCode[])
		.map((code) => ({ code, label: languageLabel(code) }))
		.sort((a, b) => compare(a.label, b.label));
	return [{ code: "auto", label: autoLabel }, ...rest];
}
