// Builds Action items and Matter lanes from metadataCache.

import { normalizePath, TFile, type App } from 'obsidian';
import type { PersonEntry } from '../services/personModel';
import type { MattersSettings } from '../settings';
import type { Ymd } from '../model/dates';
import { toActionItem, type ActionItem } from '../services/actionItems';
import type { ResolveLink } from '../services/effective';
import type { MatterInfo } from '../services/boardModel';
import {
	linkedNotes as linkedNoteTargets,
	linkedTarget,
	matterInfo as matterInfoOf,
	matterList,
	peopleIndex as peopleIndexOf,
	peoplePaths as peoplePathsOf,
	type NoteData,
	type ResolveTarget,
} from '../services/notesModel';
import { frontmatterOf, notesOfKind } from './notes';

/** A file with its cached frontmatter, as the pure rules take notes. */
export function noteData(app: App, file: TFile): NoteData {
	return { path: file.path, basename: file.basename, frontmatter: frontmatterOf(app, file) };
}

/** Resolves link text from `sourcePath` to a vault file. */
export function targetResolver(app: App, sourcePath: string): ResolveTarget<TFile> {
	return (linkpath) => app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
}

export function resolverFor(app: App, sourcePath: string): ResolveLink {
	return (text) => {
		const file = app.metadataCache.getFirstLinkpathDest(text, sourcePath);
		if (!file) return null;
		return { path: file.path, isMatter: frontmatterOf(app, file)?.['mtm-kind'] === 'matter' };
	};
}

/** The file a frontmatter link value points to. */
export function linkedFile(app: App, raw: unknown, sourcePath: string): TFile | null {
	return linkedTarget(raw, targetResolver(app, sourcePath));
}

/** Resolved outgoing body links to other notes, without the Matter and people. */
export function linkedNotes(app: App, file: TFile, exclude: ReadonlySet<string>): TFile[] {
	const links = (app.metadataCache.getFileCache(file)?.links ?? []).map((l) => l.link);
	return linkedNoteTargets(links, file.path, targetResolver(app, file.path), exclude);
}

/** Resolved notes an Action names in mtm-people and mtm-waiting-on. */
export function peoplePaths(app: App, fm: Record<string, unknown>, sourcePath: string): Set<string> {
	return peoplePathsOf(fm, targetResolver(app, sourcePath));
}

export function actionItem(app: App, file: TFile, settings: MattersSettings): ActionItem {
	const fm = frontmatterOf(app, file) ?? {};
	const item = toActionItem(file.path, file.basename, fm, settings, resolverFor(app, file.path));
	const exclude = peoplePaths(app, fm, file.path);
	exclude.add(item.effective.matterPath);
	item.linkedCount = linkedNotes(app, file, exclude).length;
	return item;
}

/**
 * Reverse index of people: for every note an Action names in mtm-waiting-on or mtm-people,
 * the Actions that name it and whether they wait on it. People are ordinary notes; nothing is written.
 */
export function peopleIndex(app: App, settings: MattersSettings): Map<string, PersonEntry[]> {
	return peopleIndexOf(
		notesOfKind(app, 'action').map((file) => ({ ...noteData(app, file), file })),
		(sourcePath) => targetResolver(app, sourcePath),
		(note) => actionItem(app, note.file, settings),
	);
}

/** Every Action in the vault (not only those in a Bases result). */
export function allActionItems(app: App, settings: MattersSettings): ActionItem[] {
	return notesOfKind(app, 'action').map((f) => actionItem(app, f, settings));
}

export function matterInfo(app: App, file: TFile, settings: MattersSettings, today: Ymd): MatterInfo {
	return matterInfoOf(noteData(app, file), settings, today);
}

/** All Matter notes, plus the Inbox even when its note is missing or lost its mtm-kind. */
export function allMatters(app: App, settings: MattersSettings, today: Ymd): MatterInfo[] {
	const inboxFile = app.vault.getFileByPath(normalizePath(settings.inboxPath));
	const notes = notesOfKind(app, 'matter').map((f) => noteData(app, f));
	return matterList(notes, inboxFile ? noteData(app, inboxFile) : null, settings, today);
}

/** People in the Actions' mtm-people and mtm-waiting-on, most involved first. */
export function peopleOf(app: App, actionPaths: readonly string[]): TFile[] {
	const counts = new Map<TFile, number>();
	for (const path of actionPaths) {
		const file = app.vault.getFileByPath(path);
		const fm = file ? frontmatterOf(app, file) : undefined;
		if (!file || !fm) continue;
		for (const p of peoplePaths(app, fm, path)) {
			const person = app.vault.getFileByPath(p);
			if (person) counts.set(person, (counts.get(person) ?? 0) + 1);
		}
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].basename.localeCompare(b[0].basename)).map(([f]) => f);
}

/** Notes that link to `target`, except Actions (they show as cards), most recently changed first. */
export function backlinksTo(app: App, target: TFile): TFile[] {
	const out: TFile[] = [];
	for (const [source, links] of Object.entries(app.metadataCache.resolvedLinks)) {
		if (source === target.path || !links[target.path]) continue;
		const file = app.vault.getFileByPath(source);
		if (file && frontmatterOf(app, file)?.['mtm-kind'] !== 'action') out.push(file);
	}
	return out.sort((a, b) => b.stat.mtime - a.stat.mtime);
}

/** The note's body: the text after the frontmatter. `text` is the note's content, already read. */
export function noteBody(app: App, file: TFile, text: string): string {
	const end = app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset;
	// The cache counts offsets from after a byte-order mark.
	const content = text.startsWith('\uFEFF') ? text.slice(1) : text;
	return end === undefined ? content : content.slice(end).replace(/^\r?\n/, '');
}
