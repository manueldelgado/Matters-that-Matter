// What the operations read from a snapshot: Actions as items, Matters with the Inbox, people, and how links resolve.
// Built once per snapshot. What doesn't depend on the clock (every Action's item, people) is kept while a host hands
// over snapshots that share their notes, settings and link resolution (the same objects), as a held snapshot does
// between changes; across a change, the items of notes that didn't change can be carried over (`carryView`).

import { foldName } from '../files/paths';
import { toYmd, type Ymd } from '../model/dates';
import { uniqueTitle } from '../model/titles';
import { toActionItem, type ActionItem } from '../services/actionItems';
import type { MatterInfo } from '../services/boardModel';
import type { ResolveLink } from '../services/effective';
import { linkedNotes, matterList, peoplePaths, personCandidates, type NoteData, type PersonCandidate } from '../services/notesModel';
import { clock } from './clock';
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
	/** Each Matter by its path. */
	matterByPath: Map<string, MatterInfo>;
	/** The Actions of each Matter (by its effective Matter's path), in the order of `actions`. */
	actionsByMatter: Map<string, ActionItem[]>;
	people: PersonCandidate[];
	resolveLink(fromPath: string): ResolveLink;
	/** Resolves link text from a note: the target's path, or null. */
	resolvePath(link: string, fromPath: string): string | null;
}

const views = new WeakMap<Snapshot, VaultView>();

/** The part of a view that doesn't depend on the clock, and what it was built from. */
interface Settled {
	settings: Snapshot['settings'];
	resolve: Snapshot['resolve'];
	links: Snapshot['links'];
	byPath: Map<string, NoteData>;
	actions: ActionNote[];
	actionsByMatter: Map<string, ActionItem[]>;
	people: PersonCandidate[];
}

const settled = new WeakMap<readonly NoteData[], Settled>();
const carried = new WeakMap<readonly NoteData[], { from: readonly NoteData[]; changed: ReadonlySet<string> }>();

/**
 * Lets a view of the notes `to` take each Action's item from the view of `from`, except for the paths in `changed`.
 * Only for a host that knows nothing else an item depends on changed in between: the same files (so every link
 * resolves as before), the same settings, and no note's `mtm-kind` changed. Pure bookkeeping: nothing is built here.
 */
export function carryView(from: readonly NoteData[], to: readonly NoteData[], changed: ReadonlySet<string>): void {
	carried.set(to, { from, changed });
}

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

export { foldName };

/**
 * The Markdown note anywhere in the vault whose name is `name`, ignoring case and Unicode form (other than
 * `except`), or null. A new note with such a name would share its links: `[[name]]` could reach either.
 */
export function noteNamed(s: Snapshot, name: string, except?: string): string | null {
	const folded = foldName(name);
	const skip = except === undefined ? undefined : foldName(except);
	return s.notes.find((n) => foldName(n.basename) === folded && foldName(n.path) !== skip)?.path ?? null;
}

/** A free name for a new note in `folder`: taken when a file there or a Markdown note anywhere has it. */
export const freeName = (s: Snapshot, folder: string, base: string): string =>
	uniqueTitle(base, (t) => s.exists(joinPath(folder, `${t}.md`)) || noteNamed(s, t) !== null);

export function vaultView(s: Snapshot): VaultView {
	const cached = views.get(s);
	if (cached) return cached;

	const today = toYmd(clock(s));
	const { byPath, actions, actionsByMatter, people } = settle(s);
	const kind = (n: NoteData) => n.frontmatter?.['mtm-kind'];
	const resolvePath = (link: string, fromPath: string) => s.resolve(link, fromPath);
	const resolveLink = resolveLinkFor(s, byPath);

	const matterNotes = s.notes.filter((n) => kind(n) === 'matter');
	const inboxNote = byPath.get(s.settings.inboxPath) ?? null;
	const matters = matterList(matterNotes, inboxNote, s.settings, today);
	const matterByPath = new Map<string, MatterInfo>();
	for (const m of matters) if (!matterByPath.has(m.path)) matterByPath.set(m.path, m);

	const view: VaultView = { today, byPath, actions, matters, matterByPath, actionsByMatter, people, resolveLink, resolvePath };
	views.set(s, view);
	return view;
}

const resolveLinkFor =
	(s: Snapshot, byPath: Map<string, NoteData>) =>
	(fromPath: string): ResolveLink =>
	(text) => {
		const path = s.resolve(text, fromPath);
		if (!path) return null;
		return { path, isMatter: byPath.get(path)?.frontmatter?.['mtm-kind'] === 'matter' };
	};

/** The clock-free part of the view: kept for the same notes, settings and resolution, carried over a change. */
function settle(s: Snapshot): Settled {
	const known = settled.get(s.notes);
	if (known && known.settings === s.settings && known.resolve === s.resolve && known.links === s.links) return known;

	const byPath = new Map(s.notes.map((n) => [n.path, n]));
	const kind = (n: NoteData) => n.frontmatter?.['mtm-kind'];
	const resolveLink = resolveLinkFor(s, byPath);
	const carry = carried.get(s.notes);
	const earlier = carry ? settled.get(carry.from) : undefined;
	const earlierItems = earlier && earlier.settings === s.settings ? new Map(earlier.actions.map((a) => [a.note.path, a.item])) : undefined;

	const actions = s.notes
		.filter((n) => kind(n) === 'action')
		.map((note) => {
			const kept = carry?.changed.has(note.path) ? undefined : earlierItems?.get(note.path);
			if (kept) return { note, item: kept };
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

	const actionsByMatter = new Map<string, ActionItem[]>();
	for (const { item } of actions) {
		const list = actionsByMatter.get(item.effective.matterPath);
		if (list) list.push(item);
		else actionsByMatter.set(item.effective.matterPath, [item]);
	}
	const people = personCandidates(s.notes, cleanFolder(s.settings.folders.people));

	// eslint-disable-next-line @typescript-eslint/unbound-method -- kept to compare by identity, never called
	const result: Settled = { settings: s.settings, resolve: s.resolve, links: s.links, byPath, actions, actionsByMatter, people };
	settled.set(s.notes, result);
	return result;
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
