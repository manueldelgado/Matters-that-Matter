// Writes to Matter notes.

import { normalizePath, type App, type TFile } from 'obsidian';
import type { MattersSettings } from '../settings';
import { toYmd } from '../model/dates';
import { sanitiseTitle, uniqueTitle } from '../model/titles';
import { formatCadence, parseOutcome, type Cadence, type LaneOrderWrite, type MatterState } from '../model/matters';
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

/** Writes the canonical cadence, or removes it ("Never"); mtm-last-reviewed is left alone. */
export async function setReviewCadence(app: App, file: TFile, cadence: Cadence | null): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
		if (cadence) fm['mtm-review-every'] = formatCadence(cadence);
		else delete fm['mtm-review-every'];
	});
}

export async function setMatterIcon(app: App, file: TFile, icon: string): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
		fm['mtm-icon'] = icon;
	});
}

/** Puts a Matter in a Sphere, or in none (removes the property). */
export async function setMatterSphere(app: App, file: TFile, sphereId: string | null): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
		if (sphereId) fm['mtm-sphere'] = sphereId;
		else delete fm['mtm-sphere'];
	});
}

/** Writes the outcome as one line, or removes it when blank. */
export async function setMatterOutcome(app: App, file: TFile, text: string | null): Promise<void> {
	const outcome = parseOutcome(text);
	await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
		if (outcome) fm['mtm-outcome'] = outcome;
		else delete fm['mtm-outcome'];
	});
}

export interface NewMatter {
	name: string;
	icon: string;
	reviewEvery: string | null;
	sphereId?: string | null;
	outcome?: string | null;
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
	if (init.sphereId) fm['mtm-sphere'] = init.sphereId;
	const outcome = parseOutcome(init.outcome);
	if (outcome) fm['mtm-outcome'] = outcome;
	return createNote(app, `${folder}/${title}.md`, fm);
}
