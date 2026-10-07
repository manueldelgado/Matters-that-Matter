// Executes a setup plan. Files first; settings are saved last, so a failed run can simply be repeated
// (setup never overwrites, so the second run reuses what the first one created).

import { normalizePath, TFile, type App } from 'obsidian';
import { isLinkTo, type PlannedValue, type SetupPlan } from '../services/setupPlan';
import { createNote, ensureFolder, linkTo, type Frontmatter } from './notes';

function resolveValues(app: App, values: Record<string, PlannedValue>, sourcePath: string): Frontmatter {
	const out: Frontmatter = {};
	for (const [key, value] of Object.entries(values)) {
		if (!isLinkTo(value)) out[key] = value;
		else {
			const target = app.vault.getFileByPath(normalizePath(value.linkTo));
			if (target) out[key] = linkTo(app, target, sourcePath);
		}
	}
	return out;
}

export async function executePlan(app: App, plan: SetupPlan): Promise<void> {
	for (const folder of plan.folders) await ensureFolder(app, folder);

	for (const note of plan.create) {
		if (app.vault.getAbstractFileByPath(normalizePath(note.path))) continue;
		if (note.kind === 'board') await app.vault.create(normalizePath(note.path), note.body);
		else await createNote(app, note.path, resolveValues(app, note.frontmatter, note.path), note.body);
	}

	for (const change of plan.modify) {
		const file = app.vault.getAbstractFileByPath(normalizePath(change.path));
		if (!(file instanceof TFile)) continue;
		const add = resolveValues(app, change.add, change.path);
		await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
			fm['mtm-kind'] = add['mtm-kind'];
			// Adoption keeps a state the note already has.
			if (fm['mtm-state'] === undefined && add['mtm-state'] !== undefined) fm['mtm-state'] = add['mtm-state'];
		});
	}
}
