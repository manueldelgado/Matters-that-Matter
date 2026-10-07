// Writes to Action notes. Every write here comes from a user action and sets status, Matter and type
// explicitly, which also clears orphan badges.

import { normalizePath, TFile, type App } from 'obsidian';
import type { MattersSettings } from '../settings';
import { toYmd } from '../model/dates';
import { sanitiseTitle, uniqueTitle } from '../model/titles';
import { applyStatus } from '../services/completion';
import { effectiveAction } from '../services/effective';
import { STRINGS } from '../strings';
import { resolverFor } from './index';
import { createNote, ensureFolder, frontmatterOf, linkTo, type Frontmatter } from './notes';

export interface ActionTarget {
	statusId?: string;
	matterPath?: string;
	typeId?: string;
}

/** Link text for a Matter path, falling back to the bare name when the note is missing. */
function matterLink(app: App, matterPath: string, sourcePath: string): string {
	const file = app.vault.getFileByPath(normalizePath(matterPath));
	if (file) return linkTo(app, file, sourcePath);
	return `[[${matterPath.split('/').pop()?.replace(/\.md$/i, '') ?? matterPath}]]`;
}

/** Moves an Action to another status, Matter or type; the other two fields are written as they are shown. */
export async function moveAction(app: App, file: TFile, target: ActionTarget, settings: MattersSettings): Promise<void> {
	const current = effectiveAction(frontmatterOf(app, file), settings, resolverFor(app, file.path));
	const status = settings.statuses.find((s) => s.id === (target.statusId ?? current.status.id)) ?? current.status;
	const typeId = target.typeId ?? current.type.id;
	const matterPath = target.matterPath ?? current.matterPath;
	const today = toYmd(new Date());
	await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
		applyStatus(fm, status, current.category, today);
		fm['mtm-type'] = typeId;
		fm['mtm-matter'] = matterLink(app, matterPath, file.path);
	});
}

/** Dismissing an orphan badge writes the values the Action is shown with. */
export async function dismissOrphan(app: App, file: TFile, settings: MattersSettings): Promise<void> {
	await moveAction(app, file, {}, settings);
}

export interface NewAction {
	title: string;
	statusId: string;
	matterPath: string;
	typeId: string;
	extra?: Frontmatter;
}

/** Creates an Action note in the Actions folder with explicit status, Matter and type. */
export async function createAction(app: App, settings: MattersSettings, init: NewAction): Promise<TFile> {
	const folder = normalizePath(settings.folders.actions);
	await ensureFolder(app, folder);
	const base = sanitiseTitle(init.title) || STRINGS.untitledAction;
	const title = uniqueTitle(base, (t) => app.vault.getAbstractFileByPath(`${folder}/${t}.md`) !== null);
	const path = `${folder}/${title}.md`;
	const status = settings.statuses.find((s) => s.id === init.statusId);
	const fm: Frontmatter = {
		'mtm-kind': 'action',
		'mtm-type': init.typeId,
		'mtm-status': init.statusId,
		'mtm-matter': matterLink(app, init.matterPath, path),
		...init.extra,
	};
	if (status?.category === 'closed') fm['mtm-completed'] = toYmd(new Date());
	return createNote(app, path, fm);
}
