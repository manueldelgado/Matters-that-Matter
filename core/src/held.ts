// Snapshots the core holds between requests, so a long-lived host (an app, a server) hands the vault over once and
// then only what changes. A held snapshot keeps the index of every note and the operations' view of it; a change
// re-reads only the notes it names. Each request then brings only what changes per call: the clock, the zone and new
// IDs. Every answer is the one the same files would get handed over whole: the tests run the corpus both ways.
// Holds state for the life of the JavaScript context, and nothing else: no files, no clock.

import type { FrontmatterInfo } from '../../src/files/frontmatter';
import { VaultIndex, type LinkConfig, type VaultReader } from '../../src/files/index';
import type { Snapshot } from '../../src/ops/types';
import { carryView } from '../../src/ops/vaultView';
import type { MattersSettings } from '../../src/settings';
import { migrateSettings } from '../../src/services/migrations';
import type { CachedNote, HeldRef, LinkSettings, SerialisedSnapshot, SnapshotCache, SnapshotChange } from './boundary';
import { checkZone, DEFAULT_CONFIG_DIR, idsFrom, instant, linkConfigOf, noteWithoutVersion, readerOf, settledSnapshot, SnapshotError, type OpenedSnapshot } from './snapshot';

interface Held {
	configDir: string;
	linkSettings: LinkSettings | undefined;
	links: LinkConfig;
	/** Every file as given (the index leaves out those Obsidian doesn't list). */
	files: string[];
	contents: Map<string, string>;
	/** Each note's version, when the snapshot has versions. */
	versions: Map<string, string> | null;
	settings: MattersSettings;
	settingsVersion: string | undefined;
	index: VaultIndex;
	reader: VaultReader;
	/** The snapshot without the clock, the zone and the IDs: the same object until a change. */
	settled: Omit<Snapshot, 'now' | 'timeZone' | 'newId'>;
}

const held = new Map<string, Held>();
let opened = 0;

const own = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

function hold(parts: Omit<Held, 'index' | 'reader' | 'settled'>, reuse?: VaultIndex, parsed?: (path: string, content: string) => FrontmatterInfo | undefined, versionsField = '/snapshot/versions'): Held {
	const reader = readerOf(() => parts.files, (path) => parts.contents.get(path) ?? null, parts.configDir, parts.links);
	const index = new VaultIndex(reader, { configDir: parts.configDir, ...(reuse ? { reuse } : {}), ...(parsed ? { parsed } : {}) });
	const versions = parts.versions;
	if (versions) {
		const missing = noteWithoutVersion(index, (path) => versions.has(path));
		if (missing !== undefined) throw new SnapshotError('bad-snapshot', `${missing} has no version; with versions, every note needs one.`, versionsField);
	}
	const settled = settledSnapshot(index, parts.settings, versions ? (path) => versions.get(path) : null, parts.settingsVersion, versionsField);
	return { ...parts, index, reader, settled };
}

/** Holds a vault handed over whole, as a request's `snapshot` would give it; answers its handle. */
export function openHeld(given: SerialisedSnapshot, cache: SnapshotCache | undefined): { handle: string; notes: number } {
	instant(given.now);
	checkZone(given.timeZone);
	const listed = new Set(given.files);
	for (const path of Object.keys(given.contents)) {
		if (!listed.has(path)) throw new SnapshotError('bad-snapshot', `${path} has content but isn't one of the files.`, '/snapshot/contents');
	}
	const versions = given.versions ? new Map(Object.entries(given.versions)) : null;
	const cached = cache && versions ? cache.notes : undefined;
	const parsed = cached
		? (path: string): FrontmatterInfo | undefined => {
				const c = own(cached, path) ? cached[path] : undefined;
				return c && c.version === versions?.get(path) ? { frontmatter: c.frontmatter, end: c.end, bodyLine: c.bodyLine } : undefined;
			}
		: undefined;
	const state = hold(
		{
			configDir: given.configDir ?? DEFAULT_CONFIG_DIR,
			linkSettings: given.linkSettings,
			links: linkConfigOf(given.linkSettings),
			files: [...given.files],
			contents: new Map(Object.entries(given.contents)),
			versions,
			settings: migrateSettings(given.settings),
			settingsVersion: given.settingsVersion,
		},
		undefined,
		parsed,
	);
	const handle = `s${++opened}`;
	held.set(handle, state);
	return { handle, notes: state.index.notePaths.length };
}

function find(handle: string, field: string): Held {
	const state = held.get(handle);
	if (!state) throw new SnapshotError('unknown-snapshot', `The core holds no snapshot "${handle}": it was closed, or the core was loaded again since.`, field);
	return state;
}

/** A held snapshot with this request's clock, zone and IDs, as the operations take it. */
export function heldSnapshot(ref: HeldRef): OpenedSnapshot {
	const state = find(ref.handle, '/held/handle');
	const now = instant(ref.now, '/held/now');
	checkZone(ref.timeZone, '/held/timeZone');
	const ids = idsFrom(ref.ids, '/held/ids');
	const snapshot: Snapshot = { ...state.settled, now, timeZone: ref.timeZone, ...(ids.newId ? { newId: ids.newId } : {}) };
	return { snapshot, reader: state.reader, configDir: state.configDir, links: state.links, idsUsed: ids.used };
}

const bad = (message: string, field: string) => new SnapshotError('bad-request', message, field);
const kindOf = (index: VaultIndex, path: string) => index.note(path)?.frontmatter?.['mtm-kind'];

/**
 * Changes a held snapshot: files renamed, added, changed or removed, and new settings. All or nothing: a change the
 * core refuses leaves the snapshot as it was.
 */
export function changeHeld(change: SnapshotChange): { handle: string; notes: number } {
	const before = find(change.handle, '/input/handle');
	const files = new Set(before.files);
	const contents = new Map(before.contents);
	const versions = before.versions ? new Map(before.versions) : null;
	const touched = new Set<string>();

	(change.renames ?? []).forEach(({ from, to }, i) => {
		if (!files.has(from)) throw bad(`${from} isn't one of the files.`, `/input/renames/${i}/from`);
		if (to !== from && files.has(to)) throw bad(`${to} is already one of the files.`, `/input/renames/${i}/to`);
		files.delete(from);
		files.add(to);
		const text = contents.get(from);
		contents.delete(from);
		if (text !== undefined) contents.set(to, text);
		const version = versions?.get(from);
		versions?.delete(from);
		if (version !== undefined) versions?.set(to, version);
		touched.add(from).add(to);
	});
	(change.files ?? []).forEach((f, i) => {
		touched.add(f.path);
		if (f.removed) {
			if (f.content !== undefined || f.version !== undefined) throw bad(`${f.path} is removed, so it takes no content or version.`, `/input/files/${i}`);
			if (!files.has(f.path)) throw bad(`${f.path} isn't one of the files.`, `/input/files/${i}/path`);
			files.delete(f.path);
			contents.delete(f.path);
			versions?.delete(f.path);
			return;
		}
		files.add(f.path);
		if (f.content !== undefined) contents.set(f.path, f.content);
		if (f.version !== undefined) {
			if (!versions) throw bad(`The snapshot was opened without versions, so ${f.path} takes none.`, `/input/files/${i}/version`);
			versions.set(f.path, f.version);
		}
	});

	const settingsChanged = change.settings !== undefined;
	const linksChanged = change.linkSettings !== undefined;
	const after = hold(
		{
			configDir: before.configDir,
			linkSettings: linksChanged ? change.linkSettings : before.linkSettings,
			links: linksChanged ? linkConfigOf(change.linkSettings) : before.links,
			files: [...files],
			contents,
			versions,
			settings: settingsChanged ? migrateSettings(change.settings ?? {}) : before.settings,
			settingsVersion: change.settingsVersion ?? before.settingsVersion,
		},
		before.index,
		undefined,
		'/input/files',
	);

	// Each Action's item depends on its own note, the settings, how links resolve (the files) and which notes are
	// Matters; while only the texts of some notes changed and no note became or stopped being a Matter or an Action,
	// the other items stay as they were.
	const sameFiles = after.index.files.length === before.index.files.length && after.index.files.every((path, i) => path === before.index.files[i]);
	const changedNotes = new Set([...touched].filter((path) => before.index.content(path) !== after.index.content(path)));
	const sameKinds = [...changedNotes].every((path) => kindOf(before.index, path) === kindOf(after.index, path));
	if (sameFiles && !settingsChanged && sameKinds) carryView(before.settled.notes, after.settled.notes, changedNotes);

	held.set(change.handle, after);
	return { handle: change.handle, notes: after.index.notePaths.length };
}

/** A value JSON gives back as it was: finite numbers (not -0), text, booleans, null, arrays and plain objects. */
function plain(value: unknown): boolean {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
	if (Array.isArray(value)) return value.every(plain);
	if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.values(value).every(plain);
	return false;
}

/**
 * Each note's properties as read, by path and version, for the host to keep and hand back to `openSnapshot`. Only
 * with versions; a note whose properties JSON can't carry exactly (an infinite number, say) is left out and read again.
 */
export function exportHeld(handle: string): SnapshotCache {
	const state = find(handle, '/input/handle');
	const notes: Record<string, CachedNote> = {};
	if (state.versions) {
		for (const path of state.index.notePaths) {
			const note = state.index.note(path);
			const version = state.versions.get(path);
			if (!note || version === undefined || !plain(note.frontmatter)) continue;
			notes[path] = { version, frontmatter: note.frontmatter, end: note.frontmatterEnd, bodyLine: note.bodyLine };
		}
	}
	return { format: 1, notes };
}

/** Lets a held snapshot go; whether the core held it. */
export function closeHeld(handle: string): { closed: boolean } {
	return { closed: held.delete(handle) };
}
