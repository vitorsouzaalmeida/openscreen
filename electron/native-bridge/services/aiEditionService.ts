import { documentSchema } from "../../../src/lib/ai-edition/schema";
import type {
	AiEditionAssetResult,
	AiEditionDeleteResult,
	AiEditionDocumentResult,
	AiEditionProjectRecordingsResult,
	AiEditionProjectSummary,
	AiEditionRecordingsDisposal,
} from "../../../src/native/contracts";
import type { DocumentService } from "../../ai-edition/document-service";
import { findProjectRecordings, removeRecordingSets } from "../../ai-edition/project-recordings";
import { forgetMediaLinks } from "../../media/mediaLinksRegistry";

export interface AiEditionServiceOptions {
	documents: DocumentService;
	/** OpenScreen's recordings folders. Absent: a project's recordings are always kept. */
	recordings?: {
		dirs: () => string[];
		/** Where `media-links.registry.json` lives. */
		registryDir: () => string;
		trashItem: (filePath: string) => Promise<void>;
	};
}

export class AiEditionService {
	constructor(private readonly options: AiEditionServiceOptions) {}

	async listProjects(): Promise<AiEditionProjectSummary[]> {
		return this.options.documents.listProjects();
	}

	async get(projectId: string): Promise<AiEditionDocumentResult> {
		try {
			const document = await this.options.documents.getProject(projectId);
			return { success: true, document };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async create(title?: string): Promise<AiEditionDocumentResult> {
		try {
			const document = await this.options.documents.createProject(title ?? "");
			return { success: true, document };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async save(document: unknown): Promise<AiEditionDocumentResult> {
		try {
			const parsed = documentSchema.parse(document);
			const saved = await this.options.documents.saveProject(parsed);
			return { success: true, document: saved };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async projectRecordings(projectId: string): Promise<AiEditionProjectRecordingsResult> {
		const recordings = this.options.recordings;
		if (!recordings) return { success: true, count: 0, sizeBytes: 0, keptFor: [], unreadable: 0 };
		try {
			const { owned, keptFor, unreadable } = await findProjectRecordings(
				projectId,
				await this.options.documents.readAllProjectsReport(),
				recordings.dirs(),
			);
			return {
				success: true,
				count: owned.length,
				sizeBytes: owned.reduce((sum, set) => sum + set.sizeBytes, 0),
				keptFor,
				unreadable,
			};
		} catch (error) {
			return {
				success: false,
				count: 0,
				sizeBytes: 0,
				keptFor: [],
				unreadable: 0,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async deleteProject(
		projectId: string,
		disposal: AiEditionRecordingsDisposal = "keep",
	): Promise<AiEditionDeleteResult> {
		const recordings = this.options.recordings;
		// The recordings go before the project: a project whose files could not be removed is
		// kept, so the user can retry, instead of leaving takes that nothing points at any more.
		if (disposal !== "keep" && recordings) {
			let removing = false;
			try {
				const { owned, unreadable } = await findProjectRecordings(
					projectId,
					await this.options.documents.readAllProjectsReport(),
					recordings.dirs(),
				);
				// A project file broke since the dialog asked: deleting the project alone would
				// quietly drop the recordings the user chose to remove, so delete nothing.
				if (unreadable > 0) {
					return {
						success: false,
						error: `${unreadable} project file(s) could not be read, so recordings they may use were not deleted`,
					};
				}
				// The project file is moved aside before any recording goes, so a project that
				// cannot be deleted never ends up pointing at recordings that are gone.
				await this.options.documents.deleteProjectAfter(projectId, async () => {
					removing = true;
					await removeRecordingSets(owned, disposal, recordings.trashItem);
					removing = false;
				});
				await forgetMediaLinks(
					recordings.registryDir(),
					owned.flatMap((set) => set.files),
				).catch((error) => console.warn("[ai-edition] could not update media links:", error));
			} catch (error) {
				return {
					success: false,
					// Only the Trash refusing earns the offer to delete permanently, not a failed scan.
					trashFailed: removing && disposal === "trash",
					error: error instanceof Error ? error.message : String(error),
				};
			}
		} else {
			try {
				await this.options.documents.deleteProject(projectId);
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}
		return { success: true };
	}

	async addAsset(
		projectId: string,
		path: string,
		label?: string,
		kind?: "video" | "audio",
	): Promise<AiEditionAssetResult> {
		const document = await this.options.documents.addAsset(projectId, { path, label, kind });
		// The just-added asset is always the last one; primaryAssetId is only a
		// fallback for the video case and would point at the wrong asset for an
		// audio import (which never claims primary), so prefer the tail.
		const assetId = document.assets.at(-1)?.id ?? document.project.primaryAssetId ?? "";
		return { assetId, document };
	}

	async removeAsset(projectId: string, assetId: string): Promise<AiEditionAssetResult> {
		const document = await this.options.documents.removeAsset(projectId, assetId);
		return { assetId, document };
	}
}
