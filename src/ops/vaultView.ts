// What the operations read from a snapshot: Actions as items, Matters with the Inbox, people, and how links resolve.
// Built once per snapshot.

import { toYmd, type Ymd } from '../model/dates';
import { uniqueTitle } from '../model/titles';
import { toActionItem, type ActionItem } from '../services/actionItems';
import type { MatterInfo } from '../services/boardModel';
import type { ResolveLink } from '../services/effective';
import { linkedNotes, matterList, peoplePaths, personCandidates, type NoteData, type PersonCandidate } from '../services/notesModel';
import type { Snapshot } from './types';

export interface ActionNote {
	note: NoteData;
	item: ActionItem;
}

export interface VaultView {
	today: Ymd;
	byPath: Map<string, NoteData>;
	actions: ActionNote[];
	matters: MatterInfo[];
	people: PersonCandidate[];
	resolveLink(fromPath: string): ResolveLink;
	/** Resolves link text from a note: the target's path, or null. */
	resolvePath(link: string, fromPath: string): string | null;
}

const views = new WeakMap<Snapshot, VaultView>();

/** A folder path without leading, trailing or doubled slashes ('' for the vault's root). */
export function cleanFolder(folder: string): string {
	return folder.split('/').filter(Boolean).join('/');
}

export function joinPath(folder: string, name: string): string {
	const clean = cleanFolder(folder);
	return clean ? `${clean}/${name}` : name;
}

export const folderOfPath = (path: string): string => {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? '' : path.slice(0, slash);
};

export const baseName = (path: string): string => (path.split('/').pop() ?? path).replace(/\.md$/i, '');

/**
 * The Markdown note anywhere in the vault whose name is `name`, ignoring case (other than `except`), or null. A new
 * note with such a name would share its links: `[[name]]` could reach either.
 */
export function noteNamed(s: Snapshot, name: string, except?: string): string | null {
	const lower = name.toLowerCase();
	const skip = except?.toLowerCase();
	return s.notes.find((n) => n.basename.toLowerCase() === lower && n.path.toLowerCase() !== skip)?.path ?? null;
}

/** A free name for a new note in `folder`: taken when a file there or a Markdown note anywhere has it. */
export const freeName = (s: Snapshot, folder: string, base: string): string =>
	uniqueTitle(base, (t) => s.exists(joinPath(folder, `${t}.md`)) || noteNamed(s, t) !== null);

export function vaultView(s: Snapshot): VaultView {
	const cached = views.get(s);
	if (cached) return cached;

	const today = toYmd(s.now);
	const byPath = new Map(s.notes.map((n) => [n.path, n]));
	const kind = (n: NoteData) => n.frontmatter?.['mtm-kind'];
	const resolvePath = (link: string, fromPath: string) => s.resolve(link, fromPath);
	const resolveLink =
		(fromPath: string): ResolveLink =>
		(text) => {
			const path = s.resolve(text, fromPath);
			if (!path) return null;
			return { path, isMatter: byPath.get(path)?.frontmatter?.['mtm-kind'] === 'matter' };
		};

	const actions = s.notes
		.filter((n) => kind(n) === 'action')
		.map((note) => {
			const fm = note.frontmatter ?? {};
			const item = toActionItem(note.path, note.basename, fm, s.settings, resolveLink(note.path));
			const exclude = peoplePaths(fm, (t) => {
				const path = s.resolve(t, note.path);
				return path ? { path } : null;
			});
			exclude.add(item.effective.matterPath);
			item.linkedCount = linkedNotes(s.links(note.path), note.path, (t) => targetOf(s.resolve(t, note.path)), exclude).length;
			return { note, item };
		});

	const matterNotes = s.notes.filter((n) => kind(n) === 'matter');
	const inboxNote = byPath.get(s.settings.inboxPath) ?? null;
	const matters = matterList(matterNotes, inboxNote, s.settings, today);
	const people = personCandidates(s.notes, cleanFolder(s.settings.folders.people));

	const view: VaultView = { today, byPath, actions, matters, people, resolveLink, resolvePath };
	views.set(s, view);
	return view;
}

/** A resolved path as a link target (its extension tells notes from attachments). */
export function targetOf(path: string | null): { path: string; extension: string } | null {
	if (!path) return null;
	const name = path.split('/').pop() ?? path;
	const dot = name.lastIndexOf('.');
	return { path, extension: dot < 0 ? '' : name.slice(dot + 1).toLowerCase() };
}

/** Only `mtm-` properties, as other tools may see them. */
export function mtmProperties(fm: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fm ?? {})) if (key.startsWith('mtm-')) out[key] = value;
	return out;
}
