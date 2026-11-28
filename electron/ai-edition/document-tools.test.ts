// The document tools' surface: that the three things describing a tool (its name in the
// roster, its description, the executor's switch) stay one list, what the descriptions and
// the editing guidance promise, and the async step `runDocumentTool` takes before the
// synchronous executor: the cursor read, the saved presets, the compositor's shader check.

import { describe, expect, it } from "vitest";
import { AUDIO_FADE_MAX_MS } from "../../src/lib/ai-edition/document/audioTracks";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../src/lib/ai-edition/schema";
import type { StylePreset } from "../../src/lib/ai-edition/stylePresets";
import { factoryStylePresetAppearance } from "../../src/lib/ai-edition/stylePresetsEditor";
import { ZOOM_DEPTH_LEGEND, ZOOM_DEPTH_SCALES } from "../../src/lib/ai-edition/timeline/zoom-scale";
import { executeAgentTool, isMutatingTool, OPENSCREEN_TOOL_NAMES } from "./agent-tools";
import {
	type CursorTelemetryReader,
	editingGuidance,
	probeCursorTelemetry,
	runDocumentTool,
	TOOL_ARG_SCHEMAS,
	TOOL_DESCRIPTIONS,
	type ToolRuntime,
} from "./document-tools";

const OPENSCREEN_TOOLS: readonly string[] = OPENSCREEN_TOOL_NAMES;
/** The editing guidance a client is handed as the server's instructions. */
const GUIDANCE = editingGuidance();

it("describes the visible transcript marks left by a non-destructive word cut", () => {
	expect(TOOL_DESCRIPTIONS.removeWords).toMatch(/red.*strikethrough/i);
	expect(TOOL_DESCRIPTIONS.removeWords).toContain("Restore");
	expect(TOOL_DESCRIPTIONS.removeWords).not.toContain("The transcript is untouched.");
});

/** Valid arguments for every tool, chosen so the executor's verdict is split
 * across the table: some succeed, some are refused for an unknown id, and
 * `replaceTimeline` is refused for the user-placed clips. */
const ARGS: Record<string, unknown> = {
	getCurrentDocument: {},
	getTranscript: {},
	getTranscriptWords: {},
	getCursorTrack: {},
	setWordText: { wordId: "word_1", text: "Hullo" },
	removeWords: { wordIds: ["word_1"] },
	addTrim: { startSec: 1, endSec: 2 },
	addTrims: { ranges: [{ startSec: 1, endSec: 2 }] },
	setTrim: { trimRangeId: "trim_1", startSec: 1, endSec: 2 },
	setClipRange: { clipId: "clip_1", sourceStartSec: 0, sourceEndSec: 10 },
	moveClip: { clipId: "clip_1", beforeClipId: null },
	insertClip: { assetId: "asset_1", sourceStartSec: 2, sourceEndSec: 4 },
	duplicateClip: { clipId: "clip_1" },
	replaceTimeline: { intervals: [{ startSec: 0, endSec: 10 }] },
	addZoom: { startSec: 1, endSec: 2 },
	addZooms: { regions: [{ startSec: 1, endSec: 2 }] },
	// No cursor reader in these tests: the refusal that says it could not look.
	addAutoZooms: {},
	setZoom: { zoomId: "zoom_nope" },
	addSpeed: { startSec: 1, endSec: 2 },
	setSpeed: { speedId: "speed_nope" },
	addAnnotation: { startSec: 1, endSec: 2, text: "hi" },
	setAnnotation: { annotationId: "ann_nope" },
	addCameraFullscreen: { startSec: 1, endSec: 2 },
	setCameraFullscreen: { cameraFullscreenId: "cam_nope" },
	// No checker in these tests: the effect is stored unchecked, and the result says so.
	addEffect: {
		startSec: 1,
		endSec: 2,
		effect: {
			name: "Pass-through",
			description: "Shows the frame unchanged.",
			code: "fn effect(uv: vec2<f32>) -> vec4<f32> { return frame(uv); }",
		},
	},
	setEffect: { effectRegionId: "fxr_nope" },
	setEffectDefinition: { effectId: "fx_nope" },
	getEffect: { effectId: "fx_nope" },
	// The fixture has no `kind: "audio"` asset, so these exercise the refusal branch —
	// the honest one to pin: the agent can place imported audio, never import it.
	addAudio: { assetId: "audio_nope", startSec: 1, endSec: 2 },
	setAudio: { audioId: "audio_nope" },
	addLayoutChange: { timeSec: 1, preset: "no-webcam" },
	setLayoutPreset: { layoutId: "layout_nope", preset: "no-webcam" },
	moveLayoutBoundary: { layoutId: "layout_nope", timeSec: 2 },
	removeTrim: { trimRangeId: "trim_1" },
	removeModifier: { id: "nope" },
	removeClip: { clipId: "clip_1" },
	setAspectRatio: { aspectRatio: "16:9" },
	setEditorSettings: { padding: 30 },
	listStylePresets: {},
	applyStylePreset: { presetId: "openscreen-factory" },
	getCaptions: {},
	setCaptionSettings: { enabled: true, style: "bold" },
	getCaptionTranslationUnits: { language: "fr" },
	putCaptionTranslation: {
		language: "fr",
		assetId: "asset_1",
		units: [{ id: "u:seg_1", text: "Bonjour" }],
	},
	// The fixture has no translation layer, so this one is refused.
	removeCaptionTranslation: { language: "fr" },
	setVocabulary: { vocabulary: "OpenScreen, Whisper" },
};

/** ponytail: the fixture starts from a FIXED instant. `createEmptyDocument` reads
 *  the wall clock when a caller hands it no `createdAt`, so two documents built by
 *  two calls carry different `createdAt`/`updatedAt` whenever the calls straddle a
 *  millisecond — which is what made an assertion over in `agent-tools.test.ts` fail
 *  a PR that touched none of it. Nothing here compares two documents yet; pinning is
 *  what keeps the one that does from being a coin flip on a loaded runner. */
const FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";

function fixtureDocument(): AxcutDocument {
	const base = createEmptyDocument({
		title: "Test",
		projectId: "proj_1",
		createdAt: FIXTURE_CREATED_AT,
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "Recording",
				originalPath: "/tmp/rec.mp4",
				durationSec: 30,
			},
		],
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{
						id: "seg_1",
						kind: "speech",
						startSec: 0,
						endSec: 5,
						text: "Hello",
						// A real word, so `setWordText` lands on its WRITE branch in the table
						// below — a tool refused for an unknown id would look non-mutating.
						wordIds: ["word_1"],
					},
				],
				words: [{ id: "word_1", segmentId: "seg_1", startSec: 0, endSec: 5, text: "Hello" }],
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: 30,
					timelineStartSec: 0,
					timelineEndSec: 30,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: [
				{ id: "trim_1", assetId: "asset_1", startSec: 10, endSec: 12, reason: "", origin: "user" },
			],
		},
	});
}

describe("the tool surface a client is served", () => {
	// No count in the title: the number moved twice without either copy of the
	// roster following, and a title is the one place a stale number cannot fail.
	it("is exactly the tools OpenScreen declares, in that order", () => {
		expect(TOOL_ARG_SCHEMAS.map(([name]) => name)).toEqual(OPENSCREEN_TOOLS);
	});

	it("describes every tool it serves, and serves every tool it describes", () => {
		// Two surfaces that must not drift: a tool with no description reaches the
		// model as a bare name, and a description with no tool is dead prose.
		expect(Object.keys(TOOL_DESCRIPTIONS).sort()).toEqual([...OPENSCREEN_TOOLS].sort());
		for (const name of OPENSCREEN_TOOLS) {
			expect(TOOL_DESCRIPTIONS[name], `${name} has no description`).toBeTruthy();
		}
	});

	it("lets a malformed batch entry reach the executor instead of failing at the schema", async () => {
		// The MCP SDK parses a tool's schema BEFORE calling us, so a batch schema that
		// enforced its element shape would reject the whole call there: the per-item
		// `refused[index]` that `addTrims` promises could never happen on the product path.
		const args = { ranges: [{ startSec: 1, endSec: 2 }, { startSec: "oops" }] };
		const schema = TOOL_ARG_SCHEMAS.find(([name]) => name === "addTrims")?.[1];
		expect(schema?.safeParse(args).success).toBe(true);

		const execution = await runDocumentTool(fixtureDocument(), "addTrims", args, {});
		const result = JSON.parse(execution.resultJson);
		expect(result.appliedCount).toBe(1);
		expect(result.refused[0].index).toBe(1);
		expect(execution.document?.timeline.trimRanges).toHaveLength(2);
	});
});

// ─── The surfaces that describe the tools ──────────────────────────────────
//
// `agent-tools.ts` used to carry AGENT_TOOL_SPECS — a full JSON-schema
// description of all 17 tools, with a comment saying it was "sent verbatim to
// the provider". It was not: the model gets the zod schemas (`TOOL_ARG_SCHEMAS`)
// plus TOOL_DESCRIPTIONS. So the surface
// humans read and the surface the model read were two different documents, and
// only one of them had a reader who would notice it drifting. The specs are
// gone; these tests are what keeps the remaining three in step.
describe("one description of the tools, not two", () => {
	it("every described tool is built, and every built tool is executable", () => {
		// The third surface is the executor's own switch, which answers
		// "Unknown tool: …" for a name it does not handle. A tool that is described
		// and built but not executed would reach the model as a promise and come
		// back as an error — exactly the shape of drift the specs were supposed to
		// prevent and could not, being read by nobody.
		const document = fixtureDocument();
		for (const name of Object.keys(TOOL_DESCRIPTIONS)) {
			const result = executeAgentTool(document, name, JSON.stringify(ARGS[name] ?? {}));
			const error = JSON.parse(result.resultJson).error;
			expect(
				typeof error === "string" && error.startsWith("Unknown tool"),
				`${name}: ${error}`,
			).toBe(false);
		}
	});

	it("the mutating flag production reads matches the tools that return a document", () => {
		const document = fixtureDocument();
		for (const name of OPENSCREEN_TOOLS) {
			const result = executeAgentTool(document, name, JSON.stringify(ARGS[name]));
			// A read must never produce a document; a write that succeeded must.
			if (!isMutatingTool(name)) expect(result.document, `${name} wrote`).toBeUndefined();
			else if (result.ok) expect(result.document, `${name} returned nothing`).toBeDefined();
		}
		expect(OPENSCREEN_TOOLS.filter((n) => !isMutatingTool(n))).toEqual([
			"getCurrentDocument",
			"getTranscript",
			"getTranscriptWords",
			"getCursorTrack",
			"getEffect",
			"listStylePresets",
			"getCaptions",
			"getCaptionTranslationUnits",
		]);
	});
});

describe("what the descriptions say about zoom strength", () => {
	it("carries the real depth table and not the formula that never matched it", () => {
		// "depth 1–6 maps to 1.0×–3.5×" was `depth/2 + 0.5`, wrong at both ends of a
		// table running 1.25×–5.0×, and it told the model depth 3 was ~2.0× while
		// the pill on screen read 1.80×.
		for (const text of [TOOL_DESCRIPTIONS.addZoom, TOOL_DESCRIPTIONS.setZoom, GUIDANCE]) {
			expect(text).not.toMatch(/1\.0×–3\.5×|1\.0x-3\.5x/);
		}
		expect(TOOL_DESCRIPTIONS.addZoom).toContain(ZOOM_DEPTH_LEGEND);
		expect(GUIDANCE).toContain(ZOOM_DEPTH_LEGEND);
		// Derived, not retyped: editing the table must move the prompt with it.
		expect(ZOOM_DEPTH_LEGEND).toContain(`3=${ZOOM_DEPTH_SCALES[3].toFixed(2)}×`);
	});

	it("offers the blur as the way to hide a private detail, and says images are not here (#1180)", () => {
		expect(TOOL_DESCRIPTIONS.addAnnotation).toMatch(/'blur'.*email/);
		expect(TOOL_DESCRIPTIONS.addAnnotation).toMatch(/Image annotations are not available/);
		expect(GUIDANCE).toMatch(/privacy blur/);
		for (const name of ["addZoom", "setZoom"]) {
			expect(TOOL_DESCRIPTIONS[name]).toMatch(/hideCursor/);
			expect(TOOL_DESCRIPTIONS[name]).toMatch(/customScale/);
		}
		expect(TOOL_DESCRIPTIONS.setAudio).toContain(`${AUDIO_FADE_MAX_MS} ms`);
	});

	it("tells the model a full-camera region needs a linked webcam", () => {
		expect(TOOL_DESCRIPTIONS.addLayoutChange).toMatch(/hasCameraTrack/);
		expect(GUIDANCE).toMatch(/hasCameraTrack/);
	});

	it("tells every zoom and trim write where a zoom's moves are (#1028)", () => {
		for (const name of ["addZoom", "addZooms", "setZoom", "addTrim", "addTrims", "setTrim"]) {
			expect(TOOL_DESCRIPTIONS[name]).toContain("zoomOutUntilSec");
			expect(TOOL_DESCRIPTIONS[name]).toContain("cutTransitions");
		}
		expect(GUIDANCE).toMatch(/zoomInFromSec.*untrimmed/);
	});
});

describe("the prompt for a caller that can export", () => {
	it("no longer gives exporting as the example of a missing tool", () => {
		expect(GUIDANCE).toMatch(/deleting an asset\/recording, exporting\)/);
		const prompt = editingGuidance({ canExport: true });
		expect(prompt).not.toMatch(/exporting/);
		expect(prompt).toMatch(/deleting an asset\/recording\)/);
	});
});

// ─── D-TELEM: the reader is injected, and its absence is reported as ours ────
//
// `readCursorTelemetryFile` and friends existed and worked; they were wired
// only to the renderer, so the agent had no door and answered the question from
// nothing. The tool is the door. What these tests pin is the thing that would
// quietly recreate the defect: an agent whose reader is missing, or throws, must
// say "I could not look" — never "there is none".

const SAMPLES = (() => {
	const out: Array<{ timeMs: number; cx: number; cy: number; interactionType: "move" | "click" }> =
		[];
	let drift = 0;
	let clicked = false;
	for (let timeMs = 0; timeMs <= 12_000; timeMs += 33) {
		const parked = timeMs >= 4000 && timeMs <= 5600;
		if (parked) {
			// The click lands on the FIRST parked sample, so it is inside the dwell
			// window the detector reports rather than a step before it.
			const isClick = !clicked;
			clicked = true;
			out.push({ timeMs, cx: 0.8, cy: 0.25, interactionType: isClick ? "click" : "move" });
		} else {
			drift = (drift + 0.05) % 1;
			out.push({ timeMs, cx: drift, cy: drift, interactionType: "move" });
		}
	}
	return out;
})();

async function readCursorTrack(runtime: ToolRuntime, args: unknown = {}) {
	const execution = await runDocumentTool(fixtureDocument(), "getCursorTrack", args, runtime);
	return { payload: JSON.parse(execution.resultJson), execution };
}

describe("cursor telemetry reaches the model", () => {
	it("passes through what the injected reader returns", async () => {
		const { payload, execution } = await readCursorTrack({
			cursor: {
				read: async ({ assetId }) => ({ status: "ok", assetId, samples: SAMPLES }),
			},
		});

		expect(payload.available).toBe(true);
		expect(payload.sampleCount).toBe(SAMPLES.length);
		expect(payload.points.length).toBeGreaterThan(0);
		// The positions reaching the model are the recorded ones, not a centroid of
		// them: the click sample survives at its own coordinates.
		const click = payload.points.find((p: { kind?: string }) => p.kind === "click");
		expect(click).toBeTruthy();
		expect(click.cx).toBeCloseTo(0.8, 2);
		expect(click.cy).toBeCloseTo(0.25, 2);
		expect(execution.ok).toBe(true);
	});

	it("says 'unavailable' when no reader is injected", async () => {
		const { payload } = await readCursorTrack({});
		expect(payload.available).toBe(false);
		expect(payload.reason).toBe("unavailable");
	});

	it("says 'unavailable', not 'no-sidecar', when the reader throws", async () => {
		// The failure mode that would put the defect back with green tests: a
		// broken reader turning into an absence of data.
		const { payload } = await readCursorTrack({
			cursor: {
				read: async () => {
					throw new Error("EACCES: permission denied");
				},
			},
		});
		expect(payload.reason).toBe("unavailable");
		expect(payload.note).toContain("EACCES");
	});

	it("passes 'no-sidecar' through as the asset's own fact", async () => {
		const { payload } = await readCursorTrack({
			cursor: { read: async ({ assetId }) => ({ status: "no-sidecar", assetId }) },
		});
		expect(payload.reason).toBe("no-sidecar");
	});

	it("asks the reader for the asset the call names, resolving the default itself", async () => {
		const asked: string[] = [];
		const runtime: ToolRuntime = {
			cursor: {
				read: async ({ assetId }) => {
					asked.push(assetId);
					return { status: "no-sidecar", assetId };
				},
			},
		};

		await readCursorTrack(runtime);
		await readCursorTrack(runtime, { assetId: "asset_1" });

		// Both resolve to the primary asset — the wrapper and the executor must
		// agree on which asset is being reported, or the answer describes one and
		// the payload names the other.
		expect(asked).toEqual(["asset_1", "asset_1"]);
	});

	it("never hands the reader a path the model chose", async () => {
		// The tool takes an assetId; the path comes from the document. A tool that
		// accepted a path would be an arbitrary JSON reader on the user's disk.
		const seen: Array<{ originalPath: string | null }> = [];
		const runtime: ToolRuntime = {
			cursor: {
				read: async (input) => {
					seen.push({ originalPath: input.originalPath });
					return { status: "no-sidecar", assetId: input.assetId };
				},
			},
		};

		// The extra `path` is the point of the test: the model is allowed to ask
		// for anything, and the tool must ignore what it did not declare.
		await readCursorTrack(runtime, { assetId: "asset_1", path: "/etc/passwd" });

		expect(seen).toEqual([{ originalPath: fixtureDocument().assets[0].originalPath }]);
	});

	it("tells the model that blindness is not evidence", () => {
		// The executor's refusal is the mechanism; this sentence is what stops the
		// model converting it into a claim about the project, which is the half of
		// the defect no guard can reach.
		expect(GUIDANCE).toMatch(/Blindness is not evidence/);
		expect(GUIDANCE).toMatch(/hasCursorTelemetry/);
		expect(TOOL_DESCRIPTIONS.getCursorTrack).toMatch(/no-sidecar/);
		expect(TOOL_DESCRIPTIONS.getCursorTrack).toMatch(/unavailable/);
	});
});

// ─── The zoom writes answer for their focus too ─────────────────────────────
//
// `executeAgentTool` is synchronous, so a sidecar read has to happen out here,
// in the wrapper, before the executor runs. It used to happen for exactly one
// tool — which is why a zoom could name a focus and no layer, from the schema
// down to the stored region, was ever in a position to say what was actually at
// that point of the frame.
// A cursor override is a stretch of the pointer drawn again, kept in the project while the
// recorded file stays as it was. Every read an agent makes is of the pointer the project DRAWS.
describe("the pointer an agent reads is the one the project draws", () => {
	const override = {
		id: "cursor_1",
		assetId: "asset_1",
		// Over the recorded click at 4 s; it clicks at 9 s instead, somewhere else.
		sourceStartMs: 3000,
		sourceEndMs: 10_000,
		points: [{ timeMs: 9000, cx: 0.1, cy: 0.9, click: true }],
		origin: "agent" as const,
	};
	const overridden = (): AxcutDocument => ({ ...fixtureDocument(), cursorOverrides: [override] });
	const track = async (runtime: ToolRuntime, document = overridden()) =>
		JSON.parse((await runDocumentTool(document, "getCursorTrack", {}, runtime)).resultJson);

	it("applies the override over the recorded track", async () => {
		const payload = await track({
			cursor: { read: async ({ assetId }) => ({ status: "ok", assetId, samples: SAMPLES }) },
		});
		expect(payload.available).toBe(true);
		const clicks = payload.points.filter((p: { kind?: string }) => p.kind === "click");
		expect(clicks.map((p: { atSec: number }) => p.atSec)).toEqual([9]);
		expect(clicks[0]).toMatchObject({ cx: 0.1, cy: 0.9 });
	});

	it("gives a take with no pointer file the override alone", async () => {
		const payload = await track({
			cursor: { read: async ({ assetId }) => ({ status: "no-sidecar", assetId }) },
		});
		expect(payload.available).toBe(true);
		expect(payload.points.some((p: { kind?: string }) => p.kind === "click")).toBe(true);
	});

	it("still says it could not look when the recorded track was not readable", async () => {
		// The override is then only part of the answer: reporting it as the whole track would
		// hide that the rest was never read.
		const payload = await track({});
		expect(payload.available).toBe(false);
		expect(payload.reason).toBe("unavailable");
	});

	it("reports an overridden asset as having a pointer, with or without a probe", async () => {
		expect(await probeCursorTelemetry(overridden(), undefined)).toEqual({ asset_1: true });
		expect(
			await probeCursorTelemetry(overridden(), {
				read: async ({ assetId }) => ({ status: "no-sidecar", assetId }),
				probe: async () => false,
			}),
		).toEqual({ asset_1: true });
		// Without an override the probe's answer stands, and no probe is still "not checked".
		expect(await probeCursorTelemetry(fixtureDocument(), undefined)).toBeUndefined();
	});
});

describe("a zoom write is measured against the recorded track", () => {
	it("reads the track for a zoom, and not for a tool with no focus to answer for", async () => {
		const asked: string[] = [];
		const runtime: ToolRuntime = {
			cursor: {
				read: async ({ assetId }) => {
					asked.push(assetId);
					return { status: "ok", assetId, samples: SAMPLES };
				},
			},
		};

		// The pointer sits at (0.8, 0.25) across this span while the call aims at
		// the opposite corner: the write still lands, and the difference is on the
		// page instead of nowhere.
		const zoom = await runDocumentTool(
			fixtureDocument(),
			"addZoom",
			{ startSec: 4, endSec: 5.6, focus: { cx: 0.1, cy: 0.9 } },
			runtime,
		);
		expect(JSON.parse(zoom.resultJson).cursorAnchor).toMatchObject({
			available: true,
			focus: { cx: 0.1, cy: 0.9 },
			cursor: { cx: 0.8, cy: 0.25 },
		});
		// No assetId is passed by a zoom write, so the wrapper resolves the primary
		// asset — the same resolution the executor then reports against.
		expect(asked).toEqual(["asset_1"]);

		// A trim has no focus and nothing to check: it must not pay for the read.
		await runDocumentTool(fixtureDocument(), "addTrim", { startSec: 1, endSec: 2 }, runtime);
		expect(asked).toEqual(["asset_1"]);
	});
});

describe("what the descriptions say about a zoom's focus", () => {
	it("offers the measurement without turning it into an instruction", () => {
		expect(TOOL_DESCRIPTIONS.addZoom).toMatch(/cursorAnchor/);
		expect(TOOL_DESCRIPTIONS.addZoom).toMatch(/measurement, not a correction/);
		// The absence rule, spelled out in the tool that will most often omit the
		// field: a runtime that could not read a track has said nothing about the
		// recording, and the prose is the only thing standing between that silence
		// and a model reporting it as a finding.
		expect(TOOL_DESCRIPTIONS.addZoom).toMatch(/never that the recording has none/);

		// …and NOT a rule about where to zoom. A description telling the model to
		// put its focus on the pointer would swap its reading of the recording for
		// a heuristic and cap it there — the same trade the tool layer refuses when
		// it hands over a track instead of a list of moments.
		expect(TOOL_DESCRIPTIONS.addZoom).not.toMatch(/focus (?:should|must|has to|needs to)/i);
		expect(GUIDANCE).not.toMatch(/cursorAnchor/);
	});
});

describe("addAutoZooms reads the clicks through the runtime's cursor reader", () => {
	const click = (timeMs: number, interactionType?: string) => ({
		timeMs,
		cx: 0.4,
		cy: 0.6,
		...(interactionType ? { interactionType } : {}),
	});

	it("plans on the recorded clicks, as the timeline wand does", async () => {
		const reads: string[] = [];
		const cursor: CursorTelemetryReader = {
			read: async ({ assetId, originalPath }) => {
				reads.push(`${assetId}:${originalPath}`);
				return {
					status: "ok",
					assetId,
					samples: [click(3700), click(4000, "click"), click(4300, "mouseup"), click(20000)],
				};
			},
		};
		const result = await runDocumentTool(fixtureDocument(), "addAutoZooms", {}, { cursor });
		expect(reads).toEqual(["asset_1:/tmp/rec.mp4"]);
		expect(result.ok).toBe(true);
		const payload = JSON.parse(result.resultJson);
		expect(payload).toMatchObject({ added: 1, telemetry: { asset_1: "ok" } });
		expect(result.document?.zoomRanges).toMatchObject([{ focusMode: "auto" }]);
	});

	it("reports a reader that throws as a read it could not make", async () => {
		const cursor: CursorTelemetryReader = {
			read: async () => {
				throw new Error("disk gone");
			},
		};
		const result = await runDocumentTool(fixtureDocument(), "addAutoZooms", {}, { cursor });
		expect(result.ok).toBe(false);
		expect(result.resultJson).toContain("could not be read");
	});
});

describe("the style preset tools read the saved presets before the executor runs", () => {
	const preset = (padding: number): StylePreset => ({
		id: "Roomy",
		name: "Roomy",
		updatedAt: "2026-11-01T00:00:00.000Z",
		appearance: { ...factoryStylePresetAppearance(), padding },
	});

	it("hands the executor the list the runtime reads, and only to those two tools", async () => {
		let reads = 0;
		const runtime = {
			stylePresets: async () => {
				reads += 1;
				return [preset(40)];
			},
		};
		const listed = await runDocumentTool(fixtureDocument(), "listStylePresets", {}, runtime);
		expect(JSON.parse(listed.resultJson).presets.map((p: { id: string }) => p.id)).toEqual([
			"openscreen-factory",
			"Roomy",
		]);
		const applied = await runDocumentTool(
			fixtureDocument(),
			"applyStylePreset",
			{ presetId: "Roomy" },
			runtime,
		);
		expect(applied.ok).toBe(true);
		expect(JSON.parse(applied.resultJson).settings.padding).toBe(40);
		await runDocumentTool(fixtureDocument(), "getCurrentDocument", {}, runtime);
		expect(reads).toBe(2);
	});

	it("reports a folder that cannot be read rather than failing the call", async () => {
		const result = await runDocumentTool(
			fixtureDocument(),
			"listStylePresets",
			{},
			{
				stylePresets: async () => {
					throw new Error("EACCES");
				},
			},
		);
		expect(result.ok).toBe(true);
		expect(JSON.parse(result.resultJson).warning).toContain("could not be read");
	});
});

describe("an effect's code is checked off the main thread, before the executor reads it", () => {
	const LEVEL = { type: "number", name: "level", label: "Level", default: 1, min: 0, max: 2 };
	const effect = (code: string) => ({
		name: "Dim",
		description: "Dims the picture.",
		code,
		params: [LEVEL],
	});
	// The compositor's check takes a while (a Metal compile is 120 ms and more): a promise that
	// settles later, refusing `nope` and pricing the rest at 20 reads.
	const slowChecker = (asked: Array<{ code: string; params: unknown }>) => ({
		checkShaderEffect: async (
			code: string,
			params: ReadonlyArray<{ name: string; type: string }>,
		) => {
			asked.push({ code, params });
			await new Promise((resolve) => setTimeout(resolve, 5));
			return code.includes("nope")
				? { error: "error: no definition in scope for identifier: `nope`" }
				: { tier: "medium" as const, frameReads: 20, iterations: 20 };
		},
	});

	it("waits for the compositor's answer, accepting or refusing on it", async () => {
		const asked: Array<{ code: string; params: unknown }> = [];
		const runtime = slowChecker(asked);
		const accepted = await runDocumentTool(
			fixtureDocument(),
			"addEffect",
			{
				startSec: 1,
				endSec: 2,
				effect: effect("fn effect(uv: vec2<f32>) -> vec4<f32> { return frame(uv); }"),
			},
			runtime,
		);
		expect(accepted.ok).toBe(true);
		const result = JSON.parse(accepted.resultJson);
		expect(result.validated).toBe(true);
		expect(result.cost).toMatchObject({ tier: "medium", frameReads: 20 });
		expect(asked[0].params).toEqual([{ name: "level", type: "number" }]);

		const refused = await runDocumentTool(
			fixtureDocument(),
			"addEffect",
			{ startSec: 1, endSec: 2, effect: effect("fn effect(uv: vec2<f32>) -> vec4<f32> { nope }") },
			runtime,
		);
		expect(refused.ok).toBe(false);
		expect(refused.resultJson).toContain("does not compile");
	});

	it("checks a new code against the definition's parameters when only the code changes", async () => {
		const asked: Array<{ code: string; params: unknown }> = [];
		const runtime = slowChecker(asked);
		const added = await runDocumentTool(
			fixtureDocument(),
			"addEffect",
			{
				startSec: 1,
				endSec: 2,
				effect: effect("fn effect(uv: vec2<f32>) -> vec4<f32> { return frame(uv); }"),
			},
			runtime,
		);
		const { effectId } = JSON.parse(added.resultJson);
		const document = added.document as AxcutDocument;
		const code = "fn effect(uv: vec2<f32>) -> vec4<f32> { return frame(uv) * params.level; }";
		const changed = await runDocumentTool(
			document,
			"setEffectDefinition",
			{ effectId, code },
			runtime,
		);
		expect(changed.ok).toBe(true);
		expect(asked.at(-1)).toEqual({ code, params: [{ name: "level", type: "number" }] });
	});

	it("asks nothing for a tool that compiles nothing", async () => {
		const asked: Array<{ code: string; params: unknown }> = [];
		const runtime = slowChecker(asked);
		await runDocumentTool(fixtureDocument(), "addTrim", { startSec: 1, endSec: 2 }, runtime);
		expect(asked).toEqual([]);
	});
});
