// Writes to Matter notes.

import { normalizePath, type App, type TFile } from 'obsidian';
import type { MattersSettings } from '../settings';
import { toYmd } from '../model/dates';
import { sanitiseTitle, uniqueTitle } from '../model/titles';
import type { LaneOrderWrite, MatterState } from '../model/matters';
import { STRINGS } from '../strings';
import { createNote, ensureFolder, maxLaneOrder, type Frontmatter } from './notes';

export async function writeLaneOrders(app: App, writes: readonly LaneOrderWrite[]): Promise<void> {
	for (const w of writes) {
		const file = app.vault.getFileByPath(normalizePath(w.path));
		if (!file) continue;
		await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
			fm['mtm-lane-order'] = w.laneOrder;
		});
	}
}

export async function markReviewed(app: App, file: TFile): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
		fm['mtm-last-reviewed'] = toYmd(new Date());
	});
}

export async function setMatterState(app: App, file: TFile, state: MatterState): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
		fm['mtm-state'] = state;
	});
}

export interface NewMatter {
	name: string;
	icon: string;
	reviewEvery: string | null;
}

/** Creates an active Matter in the Matters folder, after the last lane. */
export async function createMatter(app: App, settings: MattersSettings, init: NewMatter): Promise<TFile> {
	const folder = normalizePath(settings.folders.matters);
	await ensureFolder(app, folder);
	const base = sanitiseTitle(init.name) || STRINGS.untitledMatter;
	const title = uniqueTitle(base, (t) => app.vault.getAbstractFileByPath(`${folder}/${t}.md`) !== null);
	const fm: Frontmatter = {
		'mtm-kind': 'matter',
		'mtm-icon': init.icon,
		'mtm-state': 'active',
		'mtm-lane-order': Math.floor(maxLaneOrder(app) ?? 0) + 1,
	};
	if (init.reviewEvery) fm['mtm-review-every'] = init.reviewEvery;
	return createNote(app, `${folder}/${title}.md`, fm);
}
