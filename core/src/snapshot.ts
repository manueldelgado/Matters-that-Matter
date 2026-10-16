// A serialised snapshot opened as the operations' `Snapshot`: the files indexed as Obsidian's cache would hold them,
// the settings migrated, the clock and zone checked, versions and IDs answered from the caller's lists. Pure.

import { VaultIndex, type LinkConfig, type VaultReader } from '../../src/files/index';
import { linkFormat } from '../../src/files/linkText';
import type { MattersSettings } from '../../src/settings';
import { filesSnapshot } from '../../src/files/snapshot';
import type { Snapshot } from '../../src/ops/types';
import { migrateSettings } from '../../src/services/migrations';
import type { LinkSettings, SerialisedSnapshot } from './boundary';

/** Obsidian's default configuration folder. */
export const DEFAULT_CONFIG_DIR = '.obsidian';

/** A snapshot the core can't read as given, or one that ran out of IDs: the request fails with this code. */
export class SnapshotError extends Error {
	constructor(
		readonly code: 'bad-snapshot' | 'not-enough-ids' | 'unknown-snapshot' | 'bad-request',
		message: string,
		readonly field?: string,
	) {
		super(message);
		this.name = 'SnapshotError';
	}
}

export interface OpenedSnapshot {
	snapshot: Snapshot;
	/** The files as the files layer reads them, for applying a plan. */
	reader: VaultReader;
	configDir: string;
	links: LinkConfig;
	/** How many IDs the operation has taken so far. */
	idsUsed(): number;
}

/** An instant with a zone, as ISO 8601 writes it; a time without one would be read in the host's zone. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

const own = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/** The moment `text` names; `field` is where the request gave it. */
export function instant(text: string, field = '/snapshot/now'): Date {
	const date = new Date(text);
	if (!INSTANT.test(text) || Number.isNaN(date.getTime())) {
		throw new SnapshotError('bad-snapshot', `"${text}" is not an instant with a zone, such as 2026-10-09T10:00:00Z.`, field);
	}
	return date;
}

export function checkZone(timeZone: string, field = '/snapshot/timeZone'): void {
	try {
		new Intl.DateTimeFormat('en-GB', { timeZone });
	} catch {
		throw new SnapshotError('bad-snapshot', `"${timeZone}" is not a time zone this host knows.`, field);
	}
}

/** The link settings with Obsidian's defaults. */
export function linkConfigOf(ls: LinkSettings | undefined): LinkConfig {
	const given = ls ?? {};
	return { alwaysUpdateLinks: given.alwaysUpdateLinks === true, newLinkFormat: linkFormat(given.newLinkFormat), useMarkdownLinks: given.useMarkdownLinks === true };
}

/** The files as the files layer reads them: the listed files, their texts, and `app.json` from the link settings. */
export function readerOf(files: () => Iterable<string>, text: (path: string) => string | null, configDir: string, links: LinkConfig): VaultReader {
	const appJson = `${configDir}/app.json`;
	return { list: files, read: (path) => (path === appJson ? JSON.stringify(links) : text(path)) };
}

/** Every note has a version once versions are given: the first that hasn't, or undefined. */
export const noteWithoutVersion = (index: VaultIndex, has: (path: string) => boolean): string | undefined => index.notePaths.find((path) => !has(path));

/** Hands out the caller's IDs in order, counting them; `field` is where the request gave them. */
export function idsFrom(ids: readonly string[] | undefined, field: string): { newId?: () => string; used: () => number } {
	let used = 0;
	if (!ids) return { used: () => used };
	return {
		newId: () => {
			const id = ids[used];
			if (id === undefined) throw new SnapshotError('not-enough-ids', `The operation needs more than the ${ids.length} IDs given.`, field);
			used++;
			return id;
		},
		used: () => used,
	};
}

/** The part of a snapshot that the clock and the IDs don't change: the files, settings, versions and links. */
export function settledSnapshot(index: VaultIndex, settings: MattersSettings, version: ((path: string) => string | undefined) | null, settingsVersion: string | undefined, versionsField: string): Omit<Snapshot, 'now' | 'timeZone' | 'newId'> {
	const { now: _now, timeZone: _zone, ...files } = filesSnapshot(index, settings, new Date(0));
	return {
		...files,
		embeds: (path) => index.body(path)?.embeds.map((ref) => ref.link) ?? [],
		...(version
			? {
					version: (path: string) => {
						const v = version(path);
						if (v !== undefined) return v;
						if (index.has(path)) throw new SnapshotError('bad-snapshot', `${path} has no version.`, versionsField);
						return null;
					},
				}
			: {}),
		...(settingsVersion !== undefined ? { settingsVersion } : {}),
	};
}

export function openSnapshot(given: SerialisedSnapshot): OpenedSnapshot {
	const configDir = given.configDir ?? DEFAULT_CONFIG_DIR;
	const now = instant(given.now);
	checkZone(given.timeZone);
	const listed = new Set(given.files);
	for (const path of Object.keys(given.contents)) {
		if (!listed.has(path)) throw new SnapshotError('bad-snapshot', `${path} has content but isn't one of the files.`, '/snapshot/contents');
	}
	const links = linkConfigOf(given.linkSettings);
	const reader = readerOf(() => given.files, (path) => (own(given.contents, path) ? (given.contents[path] ?? null) : null), configDir, links);
	const index = new VaultIndex(reader, { configDir });
	const settings = migrateSettings(given.settings);

	const versions = given.versions;
	if (versions) {
		const missing = noteWithoutVersion(index, (path) => own(versions, path));
		if (missing !== undefined) throw new SnapshotError('bad-snapshot', `${missing} has no version; with versions, every note needs one.`, '/snapshot/versions');
	}
	const ids = idsFrom(given.ids, '/snapshot/ids');
	const snapshot: Snapshot = {
		...settledSnapshot(index, settings, versions ? (path) => (own(versions, path) ? versions[path] : undefined) : null, given.settingsVersion, '/snapshot/versions'),
		now,
		timeZone: given.timeZone,
		...(ids.newId ? { newId: ids.newId } : {}),
	};
	return { snapshot, reader, configDir, links, idsUsed: ids.used };
}
