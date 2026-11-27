#!/usr/bin/env node
/**
 * Checks that every literal string key the code in src/ asks for exists in the English
 * catalog (src/i18n/locales/en), which is the only one the app ships.
 *
 * Usage: node scripts/i18n-check.mjs
 */
import fs from "node:fs";
import path from "node:path";

const CATALOG_DIR = path.resolve("src/i18n/locales/en");

let hasErrors = false;

const namespaces = fs
	.readdirSync(CATALOG_DIR)
	.filter((f) => f.endsWith(".json"))
	.map((f) => f.replace(".json", ""));

// On a miss, translate() (src/i18n/loader.ts) renders the raw "editor.rec.selectSource"
// marker, and component tests mock t to echo the key, so nothing else catches it.
// A key counts when it resolves to a string (or to i18next's _one/_other plural forms) in the
// namespace of the translator that asks for it: the nearest `const <name> = useScopedT("ns")`
// above the call, since one file often holds several components binding the same name to
// different namespaces. A name the file binds only further down counts against every namespace
// it binds; one it never binds (a prop, a parameter) against every namespace the file scopes.
// Dynamic keys (template literals, variables) can't be read statically and are skipped.
const SRC_DIR = path.resolve("src");
const baseByNamespace = Object.fromEntries(
	namespaces.map((ns) => [
		ns,
		JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, `${ns}.json`), "utf-8")),
	]),
);

function resolvesToString(tree, key) {
	const parts = key.split(".");
	const leaf = parts.pop();
	let node = tree;
	for (const part of parts) {
		node = node?.[part];
		if (!node || typeof node !== "object") return false;
	}
	return [leaf, `${leaf}_one`, `${leaf}_other`].some((k) => typeof node[k] === "string");
}

let checkedKeyCount = 0;
const sourceFiles = fs
	.readdirSync(SRC_DIR, { recursive: true })
	.filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file));
for (const file of sourceFiles) {
	const source = fs.readFileSync(path.join(SRC_DIR, file), "utf-8");
	const scopes = [
		...new Set([...source.matchAll(/useScopedT\(\s*"(\w+)"\s*\)/g)].map((m) => m[1])),
	];
	if (scopes.length === 0) continue;
	const bindings = [
		...source.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*useScopedT\(\s*"(\w+)"\s*\)/g),
	].map((m) => ({ name: m[1], ns: m[2], at: m.index }));
	// A callee is a translator when the file binds it to useScopedT, or when it is named like
	// one handed in as a prop or parameter: `t`, or `t` plus a capital (`tCommon`). Any other
	// name starting with a t, like `tierOutputDims("source")`, is not a translation call.
	const bound = new Set(bindings.map((b) => b.name));
	const isTranslator = (callee) => bound.has(callee) || /^t(?:[A-Z]\w*)?$/.test(callee);
	for (const match of source.matchAll(/\b([A-Za-z_]\w*)\(\s*"([\w.-]+)"/g)) {
		const [, callee, key] = match;
		if (!isTranslator(callee)) continue;
		checkedKeyCount++;
		const own = bindings.filter((b) => b.name === callee);
		const nearest = own.filter((b) => b.at < match.index).at(-1);
		const candidates = nearest ? [nearest.ns] : own.length > 0 ? own.map((b) => b.ns) : scopes;
		if (
			candidates.some((ns) => baseByNamespace[ns] && resolvesToString(baseByNamespace[ns], key))
		) {
			continue;
		}
		const line = source.slice(0, match.index).split("\n").length;
		const where = path.join("src", file).split(path.sep).join("/");
		const tried = [...new Set(candidates)].join(", ");
		console.error(`MISSING: ${where}:${line} ${callee}("${key}") [${tried}]`);
		hasErrors = true;
	}
}

if (hasErrors) {
	console.error("\ni18n check FAILED — keys used in src/ are missing from the English catalog.");
	process.exit(1);
} else {
	console.log(
		`i18n check PASSED — all ${checkedKeyCount} literal keys in src/ resolve across ${namespaces.length} namespaces.`,
	);
}
