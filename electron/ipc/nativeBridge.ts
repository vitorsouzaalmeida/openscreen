import { BrowserWindow, ipcMain, shell } from "electron";
import {
	NATIVE_BRIDGE_CHANNEL,
	NATIVE_BRIDGE_VERSION,
	type NativeBridgeErrorCode,
	type NativeBridgeRequest,
	type NativeBridgeResponse,
	type NativePlatform,
	type ProjectFileResult,
	type ProjectPathResult,
} from "../../src/native/contracts";
import type { DocumentService } from "../ai-edition/document-service";
import { StylePresetError, type StylePresetService } from "../ai-edition/style-preset-service";
import {
	type CursorTelemetryLoadResult,
	TelemetryCursorAdapter,
} from "../native-bridge/cursor/telemetryCursorAdapter";
import { AiEditionService } from "../native-bridge/services/aiEditionService";
import { CompositorViewService } from "../native-bridge/services/compositorViewService";
import { CursorService } from "../native-bridge/services/cursorService";
import { ProjectService } from "../native-bridge/services/projectService";
import { SystemService } from "../native-bridge/services/systemService";
import { createNativeBridgeState } from "../native-bridge/store";
import { ExportJobs, isExportId } from "./exportJobs";

export interface NativeBridgeContext {
	getPlatform: () => NodeJS.Platform;
	getCurrentProjectPath: () => string | null;
	getCurrentVideoPath: () => string | null;
	saveProjectFile: (
		projectData: unknown,
		suggestedName?: string,
		existingProjectPath?: string,
		parent?: BrowserWindow | null,
	) => Promise<ProjectFileResult>;
	loadProjectFile: (
		projectFolder?: string,
		parent?: BrowserWindow | null,
	) => Promise<ProjectFileResult>;
	loadCurrentProjectFile: () => Promise<ProjectFileResult>;
	loadProjectFileFromPath: (path: string) => Promise<ProjectFileResult>;
	setCurrentVideoPath: (path: string) => ProjectPathResult | Promise<ProjectPathResult>;
	getCurrentVideoPathResult: () => ProjectPathResult;
	clearCurrentVideoPath: () => ProjectPathResult;
	resolveAssetBasePath: () => string | null;
	resolveVideoPath: (videoPath?: string | null) => string | null;
	loadCursorRecordingData: (
		videoPath: string,
	) => Promise<import("../../src/native/contracts").CursorRecordingData>;
	loadCursorTelemetry: (videoPath: string) => Promise<CursorTelemetryLoadResult>;
	/**
	 * returns the native (HWND / NSView / xcb_window) handle buffer
	 * for the BrowserWindow that hosts the requesting renderer. Used by the
	 * compositor domain's `createView` to wire the embedded native window
	 * to its D3D11 parent. May return `null` if the sender has no live window
	 * (e.g. mid-teardown), in which case `createView` fails with UNAVAILABLE.
	 */
	getNativeWindowHandle?: (sender: import("electron").WebContents) => Buffer | null;
	getAiEditionDocuments: () => DocumentService;
	/** OpenScreen's recordings folders, the current one first. Absent: deleting a project keeps its recordings. */
	getRecordingsDirs?: () => { dirs: string[]; registryDir: string };
	/** The one shared style preset service — it serialises writes per instance. */
	getStylePresets: () => StylePresetService;
}

function normalizePlatform(platform: NodeJS.Platform): NativePlatform {
	if (platform === "darwin" || platform === "win32") {
		return platform;
	}

	return "linux";
}

function createMeta(requestId?: string) {
	return {
		version: NATIVE_BRIDGE_VERSION,
		requestId: requestId || `native-${Date.now()}`,
		timestampMs: Date.now(),
	} as const;
}

function createSuccessResponse<TData>(requestId: string | undefined, data: TData) {
	return {
		ok: true,
		data,
		meta: createMeta(requestId),
	} satisfies NativeBridgeResponse<TData>;
}

function createErrorResponse(
	requestId: string | undefined,
	code: NativeBridgeErrorCode,
	message: string,
	retryable = false,
) {
	return {
		ok: false,
		error: {
			code,
			message,
			retryable,
		},
		meta: createMeta(requestId),
	} satisfies NativeBridgeResponse;
}

/**
 * Strips absolute filesystem paths out of an error message before it crosses to
 * the renderer. Main-process errors quote the path they failed on (`ENOENT: no
 * such file or directory, open 'C:\Users\alice\…'`), and that string is rendered
 * verbatim in toasts. Keeps the basename, which is the
 * part a user can act on. The full message still goes to the main-process log.
 */
function redactPaths(message: string): string {
	return message
		.replace(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*([^\\/:*?"<>|\r\n]*)/g, "…\\$1")
		.replace(/\/(?:[^/\0\s'"]+\/)+([^/\0\s'"]*)/g, "…/$1");
}

function isBridgeRequest(value: unknown): value is NativeBridgeRequest {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Partial<NativeBridgeRequest>;
	return typeof candidate.domain === "string" && typeof candidate.action === "string";
}

export function registerNativeBridgeHandlers(context: NativeBridgeContext) {
	ipcMain.removeHandler(NATIVE_BRIDGE_CHANNEL);

	const platform = normalizePlatform(context.getPlatform());
	const store = createNativeBridgeState(platform);
	const projectService = new ProjectService({
		store,
		getCurrentProjectPath: context.getCurrentProjectPath,
		getCurrentVideoPath: context.getCurrentVideoPath,
		saveProjectFile: context.saveProjectFile,
		loadProjectFile: context.loadProjectFile,
		loadCurrentProjectFile: context.loadCurrentProjectFile,
		loadProjectFileFromPath: context.loadProjectFileFromPath,
		setCurrentVideoPath: context.setCurrentVideoPath,
		getCurrentVideoPathResult: context.getCurrentVideoPathResult,
		clearCurrentVideoPath: context.clearCurrentVideoPath,
	});
	const cursorService = new CursorService({
		store,
		adapter: new TelemetryCursorAdapter({
			loadRecordingData: context.loadCursorRecordingData,
			resolveVideoPath: context.resolveVideoPath,
			loadTelemetry: context.loadCursorTelemetry,
		}),
	});
	const systemService = new SystemService({
		store,
		getPlatform: () => platform,
		getAssetBasePath: context.resolveAssetBasePath,
		getCursorCapabilities: () => cursorService.getCapabilities(),
	});
	const compositorViewService = new CompositorViewService();
	const aiEditionService = new AiEditionService({
		documents: context.getAiEditionDocuments(),
		recordings: context.getRecordingsDirs
			? {
					dirs: () => context.getRecordingsDirs?.().dirs ?? [],
					registryDir: () => context.getRecordingsDirs?.().registryDir ?? "",
					trashItem: (filePath) => shell.trashItem(filePath),
				}
			: undefined,
	});

	const exportJobs = new ExportJobs();
	ipcMain.handle(NATIVE_BRIDGE_CHANNEL, async (event, request: unknown) => {
		if (!isBridgeRequest(request)) {
			return createErrorResponse(undefined, "INVALID_REQUEST", "Invalid native bridge request.");
		}

		const requestId = request.requestId;
		const domain = request.domain as string;

		try {
			switch (request.domain) {
				case "system": {
					const action = request.action as string;
					switch (request.action) {
						case "getPlatform":
							return createSuccessResponse(requestId, systemService.getPlatform());
						case "getAssetBasePath":
							return createSuccessResponse(requestId, systemService.getAssetBasePath());
						case "getCapabilities":
							return createSuccessResponse(requestId, await systemService.getCapabilities());
						default:
							return createErrorResponse(
								requestId,
								"UNSUPPORTED_ACTION",
								`Unsupported system action: ${action}`,
							);
					}
				}

				case "project": {
					const action = request.action as string;
					switch (request.action) {
						case "getCurrentContext":
							return createSuccessResponse(requestId, projectService.getCurrentContext());
						case "saveProjectFile":
							return createSuccessResponse(
								requestId,
								await projectService.saveProjectFile(
									request.payload.projectData,
									request.payload.suggestedName,
									request.payload.existingProjectPath,
									BrowserWindow.fromWebContents(event.sender),
								),
							);
						case "loadProjectFile":
							return createSuccessResponse(
								requestId,
								await projectService.loadProjectFile(
									request.payload?.projectFolder,
									BrowserWindow.fromWebContents(event.sender),
								),
							);
						case "loadCurrentProjectFile":
							return createSuccessResponse(
								requestId,
								await projectService.loadCurrentProjectFile(),
							);
						case "loadProjectFileFromPath":
							return createSuccessResponse(
								requestId,
								await projectService.loadProjectFileFromPath(request.payload.path),
							);
						case "setCurrentVideoPath":
							return createSuccessResponse(
								requestId,
								await projectService.setCurrentVideoPath(request.payload.path),
							);
						case "getCurrentVideoPath":
							return createSuccessResponse(requestId, projectService.getCurrentVideoPath());
						case "clearCurrentVideoPath":
							return createSuccessResponse(requestId, projectService.clearCurrentVideoPath());
						default:
							return createErrorResponse(
								requestId,
								"UNSUPPORTED_ACTION",
								`Unsupported project action: ${action}`,
							);
					}
				}

				case "cursor": {
					const action = request.action as string;
					switch (request.action) {
						case "getCapabilities":
							return createSuccessResponse(requestId, await cursorService.getCapabilities());
						case "getTelemetry":
							return createSuccessResponse(
								requestId,
								await cursorService.getTelemetry(request.payload?.videoPath),
							);
						case "getRecordingData":
							return createSuccessResponse(
								requestId,
								await cursorService.getRecordingData(request.payload?.videoPath),
							);
						default:
							return createErrorResponse(
								requestId,
								"UNSUPPORTED_ACTION",
								`Unsupported cursor action: ${action}`,
							);
					}
				}

				case "compositor": {
					const action = request.action as string;
					switch (request.action) {
						case "createView": {
							const id = compositorViewService.createView(request.payload.rect, {
								screenPath: request.payload.screenPath,
								webcamPath: request.payload.webcamPath,
								cursorPath: request.payload.cursorPath,
							});
							return createSuccessResponse(requestId, { id });
						}
						case "probeBackend":
							// No view needed: the export dialog asks before any preview exists.
							return createSuccessResponse(requestId, {
								backend: compositorViewService.probeBackend(),
							});
						case "probeSegmentation":
							// No view needed either: the layout panel decides whether to offer the
							// camera-background control before any preview exists.
							return createSuccessResponse(requestId, {
								support: compositorViewService.probeSegmentation(),
							});
						case "segmentFrame":
							return createSuccessResponse(requestId, {
								mask: await compositorViewService.segmentFrame(request.payload.rgba),
							});
						case "checkShaderEffect":
							// The inspector shows why an effect does not draw on this machine.
							return createSuccessResponse(requestId, {
								check: await compositorViewService.checkShaderEffect(
									request.payload.code,
									request.payload.params,
									request.payload.image ?? false,
								),
							});
						case "setRect":
							compositorViewService.setRect(request.payload.id, request.payload.rect);
							return createSuccessResponse(requestId, { ok: true });
						case "readFrame": {
							// The renderer polls this every rAF tick. It passes the generation it
							// last painted as `sinceGen`; native returns `null` when nothing newer
							// exists (idle path — no buffer copy). On a new frame it returns
							// `{ gen, width, height, data }`, or — for a view on shared textures —
							// sends the texture to the asking frame and returns its receipt. The
							// response wrapper does NOT JSON-stringify — `ipcMain.handle` round-trips
							// via structured clone, which preserves the nested `Buffer` as binary.
							const frame = await compositorViewService.readFrame(
								request.payload.id,
								request.payload.sinceGen,
								event.senderFrame,
							);
							return createSuccessResponse(requestId, frame);
						}
						case "stopSharedFrames":
							compositorViewService.stopSharedFrames(request.payload.id);
							return createSuccessResponse(requestId, { ok: true });
						case "setParam":
							compositorViewService.setParam(
								request.payload.id,
								request.payload.key,
								request.payload.value,
							);
							return createSuccessResponse(requestId, { ok: true });
						case "setPlaying":
							compositorViewService.setPlaying(request.payload.id, request.payload.playing);
							return createSuccessResponse(requestId, { ok: true });
						case "presentTime":
							compositorViewService.presentTime(request.payload.id, request.payload.seconds);
							return createSuccessResponse(requestId, { ok: true });
						case "setScene":
							compositorViewService.setScene(request.payload.id, request.payload.sceneJson);
							return createSuccessResponse(requestId, { ok: true });
						case "setActiveClip":
							compositorViewService.setActiveClip(
								request.payload.id,
								request.payload.screenPath,
								request.payload.webcamPath,
								request.payload.webcamOffsetSec,
								request.payload.clipIndex,
								request.payload.sourceTimeSec,
							);
							return createSuccessResponse(requestId, { ok: true });
						case "destroyView":
							compositorViewService.destroyView(request.payload.id);
							return createSuccessResponse(requestId, { ok: true });
						case "exportMulti": {
							const sender = event.sender;
							const exportId = request.payload?.exportId;
							if (exportId !== undefined && !isExportId(exportId)) {
								return createErrorResponse(requestId, "INVALID_REQUEST", "Invalid export ID.");
							}
							const onProgress = (frames: number) => {
								if (!sender.isDestroyed()) sender.send("export:native-progress", frames, exportId);
							};
							const stats = exportId
								? await exportJobs.run(
										sender,
										exportId,
										(progress) =>
											compositorViewService.startExportMulti(
												request.payload.clips,
												request.payload.outPath,
												request.payload.sceneJson,
												request.payload.params,
												progress,
											),
										onProgress,
									)
								: await compositorViewService.exportMulti(
										request.payload.clips,
										request.payload.outPath,
										request.payload.sceneJson,
										request.payload.params,
										onProgress,
									);
							if (!stats) {
								return createErrorResponse(
									requestId,
									"UNAVAILABLE",
									"Native compositor addon not present.",
								);
							}
							return createSuccessResponse(requestId, stats);
						}
						case "exportGif": {
							const sender = event.sender;
							const exportId = request.payload?.exportId;
							if (exportId !== undefined && !isExportId(exportId)) {
								return createErrorResponse(requestId, "INVALID_REQUEST", "Invalid export ID.");
							}
							const onProgress = (frames: number) => {
								if (!sender.isDestroyed()) sender.send("export:native-progress", frames, exportId);
							};
							const stats = exportId
								? await exportJobs.run(
										sender,
										exportId,
										(progress) =>
											compositorViewService.startGifExport(
												request.payload.clips,
												request.payload.outPath,
												request.payload.sceneJson,
												request.payload.params,
												progress,
											),
										onProgress,
									)
								: await compositorViewService.exportGif(
										request.payload.clips,
										request.payload.outPath,
										request.payload.sceneJson,
										request.payload.params,
										onProgress,
									);
							if (!stats) {
								return createErrorResponse(
									requestId,
									"UNAVAILABLE",
									"Native compositor addon not present.",
								);
							}
							return createSuccessResponse(requestId, stats);
						}
						case "cancelExport": {
							const exportId = request.payload?.exportId;
							if (!isExportId(exportId)) {
								return createErrorResponse(requestId, "INVALID_REQUEST", "Invalid export ID.");
							}
							return createSuccessResponse(requestId, {
								accepted: exportJobs.cancel(event.sender, exportId),
							});
						}
						default:
							return createErrorResponse(
								requestId,
								"UNSUPPORTED_ACTION",
								`Unsupported compositor action: ${action}`,
							);
					}
				}

				case "aiEdition": {
					const action = request.action as string;
					switch (request.action) {
						case "document.listProjects":
							return createSuccessResponse(requestId, await aiEditionService.listProjects());
						case "document.get":
							return createSuccessResponse(
								requestId,
								await aiEditionService.get(request.payload.projectId),
							);
						case "document.create":
							return createSuccessResponse(
								requestId,
								await aiEditionService.create(request.payload?.title),
							);
						case "document.save":
							return createSuccessResponse(
								requestId,
								await aiEditionService.save(request.payload.document),
							);
						// Renderer input: anything but "trash" would take the permanent path.
						case "document.delete": {
							const disposal: unknown = request.payload.recordings;
							if (
								disposal !== undefined &&
								disposal !== "keep" &&
								disposal !== "trash" &&
								disposal !== "permanent"
							) {
								return createErrorResponse(
									requestId,
									"INVALID_REQUEST",
									"Invalid recordings disposal.",
								);
							}
							return createSuccessResponse(
								requestId,
								await aiEditionService.deleteProject(request.payload.projectId, disposal),
							);
						}
						case "document.recordings":
							return createSuccessResponse(
								requestId,
								await aiEditionService.projectRecordings(request.payload.projectId),
							);
						case "document.addAsset":
							return createSuccessResponse(
								requestId,
								await aiEditionService.addAsset(
									request.payload.projectId,
									request.payload.path,
									request.payload.label,
									request.payload.kind,
								),
							);
						case "document.removeAsset":
							return createSuccessResponse(
								requestId,
								await aiEditionService.removeAsset(
									request.payload.projectId,
									request.payload.assetId,
								),
							);
						default:
							return createErrorResponse(
								requestId,
								"UNSUPPORTED_ACTION",
								`Unsupported aiEdition action: ${action}`,
							);
					}
				}

				case "presets": {
					const action = request.action as string;
					const presets = context.getStylePresets();
					switch (request.action) {
						case "list":
							return createSuccessResponse(requestId, await presets.list());
						case "create":
							return createSuccessResponse(
								requestId,
								await presets.create(request.payload.name, request.payload.appearance),
							);
						case "rename":
							return createSuccessResponse(
								requestId,
								await presets.rename(request.payload.id, request.payload.name),
							);
						case "update":
							return createSuccessResponse(
								requestId,
								await presets.update(request.payload.id, request.payload.appearance),
							);
						case "delete":
							await presets.delete(request.payload.id);
							return createSuccessResponse(requestId, { success: true });
						case "setForNewProjects":
							await presets.setForNewProjects(request.payload.id);
							return createSuccessResponse(requestId, { success: true });
						case "reveal": {
							// The path is built here from the id, never taken from the renderer.
							const target = await presets.revealTarget(request.payload.id);
							if (target.kind === "file") {
								shell.showItemInFolder(target.path);
							} else {
								const openError = await shell.openPath(target.path);
								if (openError) throw new Error(openError);
							}
							return createSuccessResponse(requestId, { success: true });
						}
						default:
							return createErrorResponse(
								requestId,
								"UNSUPPORTED_ACTION",
								`Unsupported presets action: ${action}`,
							);
					}
				}

				default:
					return createErrorResponse(
						requestId,
						"UNSUPPORTED_ACTION",
						`Unsupported bridge domain: ${domain}`,
					);
			}
		} catch (error) {
			if (
				request.domain === "compositor" &&
				error instanceof Error &&
				((request.action === "exportGif" && error.message === "GIF_EXPORT_CANCELLED") ||
					(request.action === "exportMulti" && error.message === "MP4_EXPORT_CANCELLED"))
			) {
				return createErrorResponse(requestId, "CANCELLED", "Export cancelled.");
			}
			// Not retryable by default: most failures here are permanent (a missing
			// file, a bad payload, an unavailable addon), and a blanket `true` tells
			// the client to spin on them. The message keeps the reason but drops any
			// absolute path — it crosses to the renderer and ends up in UI strings.
			console.error(`native bridge ${domain}.${request.action} failed:`, error);
			// Style preset failures the UI acts on keep their own code: a taken name is a
			// prompt to pick another, not a crash. A TypeError there is a preset or name that
			// failed validation, i.e. a bad request.
			if (error instanceof StylePresetError) {
				return createErrorResponse(
					requestId,
					error.code === "INVALID_ID" ? "INVALID_REQUEST" : error.code,
					redactPaths(error.message),
				);
			}
			if (domain === "presets" && error instanceof TypeError) {
				return createErrorResponse(requestId, "INVALID_REQUEST", redactPaths(error.message));
			}
			return createErrorResponse(
				requestId,
				"INTERNAL_ERROR",
				redactPaths(error instanceof Error ? error.message : "Unknown native bridge error."),
			);
		}
	});
}
