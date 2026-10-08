// Writes to Action notes. Every write here comes from a user action and sets status, Matter and type
// explicitly, which also clears orphan badges.

import { normalizePath, TFile, type App } from 'obsidian';
import type { MattersSettings } from '../settings';
import { toYmd } from '../model/dates';
import type { Priority } from '../model/actions';
import { insertTask, setDetails, toggleTask } from '../model/body';
import { sanitiseTitle, uniqueTitle } from '../model/titles';
import { applyFieldEdit, type FieldEdit } from '../services/actionEdit';
import { applyStatus } from '../services/completion';
import { effectiveAction, linkText } from '../services/effective';
import { STRINGS } from '../strings';
import { linkedFile, resolverFor } from './index';
import { createNote, ensureFolder, frontmatterOf, linkTo, pathTaken, type Frontmatter } from './notes';

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

/**
 * Edits an Action's frontmatter. Status, Matter and type are always written (the target's, or as they are shown),
 * so every edit also clears orphan badges; other fields change only when `fields` names them.
 */
export async function editAction(app: App, file: TFile, settings: MattersSettings, target: ActionTarget, fields: FieldEdit = {}): Promise<void> {
	const current = effectiveAction(frontmatterOf(app, file), settings, resolverFor(app, file.path));
	const status = settings.statuses.find((s) => s.id === (target.statusId ?? current.status.id)) ?? current.status;
	const typeId = target.typeId ?? current.type.id;
	const matterPath = target.matterPath ?? current.matterPath;
	const today = toYmd(new Date());
	const keyOf = (raw: unknown) => linkedFile(app, raw, file.path)?.path ?? linkText(raw);
	await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
		applyStatus(fm, status, current.category, today);
		fm['mtm-type'] = typeId;
		fm['mtm-matter'] = matterLink(app, matterPath, file.path);
		applyFieldEdit(fm, fields, keyOf, today);
	});
}

/** Moves an Action to another status, Matter or type; the other two fields are written as they are shown. */
export async function moveAction(app: App, file: TFile, target: ActionTarget, settings: MattersSettings): Promise<void> {
	await editAction(app, file, settings, target);
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
	priority?: Priority | null;
	/** As written: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'. */
	start?: string | null;
	due?: string | null;
	people?: readonly TFile[];
}

/** Creates an Action note in the Actions folder with explicit status, Matter and type. */
export async function createAction(app: App, settings: MattersSettings, init: NewAction): Promise<TFile> {
	const folder = normalizePath(settings.folders.actions);
	await ensureFolder(app, folder);
	const base = sanitiseTitle(init.title) || STRINGS.untitledAction;
	const title = uniqueTitle(base, (t) => pathTaken(app, `${folder}/${t}.md`));
	const path = `${folder}/${title}.md`;
	const status = settings.statuses.find((s) => s.id === init.statusId);
	const fm: Frontmatter = {
		'mtm-kind': 'action',
		'mtm-type': init.typeId,
		'mtm-status': init.statusId,
		'mtm-matter': matterLink(app, init.matterPath, path),
	};
	if (init.start) fm['mtm-start'] = init.start;
	if (init.due) fm['mtm-due'] = init.due;
	if (init.priority) fm['mtm-priority'] = init.priority;
	if (init.people?.length) fm['mtm-people'] = init.people.map((p) => linkTo(app, p, path));
	if (status?.category === 'closed') fm['mtm-completed'] = toYmd(new Date());
	return createNote(app, path, fm);
}

// ——— Body edits: only the targeted lines change ———

/** `previous` is the details text the inspector last read or wrote (see setDetails). */
export async function writeDetails(app: App, file: TFile, details: string, previous?: string): Promise<void> {
	await app.vault.process(file, (content) => setDetails(content, details, previous));
}

export async function setChecklistItem(app: App, file: TFile, line: number, text: string, checked: boolean): Promise<void> {
	await app.vault.process(file, (content) => toggleTask(content, line, text, checked));
}

export async function addChecklistItem(app: App, file: TFile, text: string): Promise<void> {
	if (!text.trim()) return;
	await app.vault.process(file, (content) => insertTask(content, text));
}

/**
 * Renames an Action after its title (links update through the file manager).
 * Returns false when the title is empty or unchanged once sanitised.
 */
export async function renameAction(app: App, file: TFile, rawTitle: string): Promise<boolean> {
	const base = sanitiseTitle(rawTitle);
	if (!base || base === file.basename) return false;
	const folder = file.parent?.path ?? '';
	const pathFor = (t: string) => normalizePath(folder && folder !== '/' ? `${folder}/${t}.md` : `${t}.md`);
	// The same name in another case is the same file: renaming "call bob" to "Call Bob" changes its case only.
	const title = uniqueTitle(base, (t) => pathTaken(app, pathFor(t), file));
	await app.fileManager.renameFile(file, pathFor(title));
	return true;
}
