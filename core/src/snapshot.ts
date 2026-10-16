// A serialised snapshot opened as the operations' `Snapshot`: the files indexed as Obsidian's cache would hold them,
// the settings migrated, the clock and zone checked, versions and IDs answered from the caller's lists. Pure.

import { VaultIndex, type LinkConfig, type VaultReader } from '../../src/files/index';
import { linkFormat } from '../../src/files/linkText';
import { filesSnapshot } from '../../src/files/snapshot';
import type { Snapshot } from '../../src/ops/types';
import { migrateSettings } from '../../src/services/migrations';
import type { SerialisedSnapshot } from './boundary';

/** Obsidian's default configuration folder. */
export const DEFAULT_CONFIG_DIR = '.obsidian';

/** A snapshot the core can't read as given, or one that ran out of IDs: the request fails with this code. */
export class SnapshotError extends Error {
	constructor(
		readonly code: 'bad-snapshot' | 'not-enough-ids',
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

function instant(text: string): Date {
	const date = new Date(text);
	if (!INSTANT.test(text) || Number.isNaN(date.getTime())) {
		throw new SnapshotError('bad-snapshot', `"${text}" is not an instant with a zone, such as 2026-10-09T10:00:00Z.`, '/snapshot/now');
	}
	return date;
}

function checkZone(timeZone: string): void {
	try {
		new Intl.DateTimeFormat('en-GB', { timeZone });
	} catch {
		throw new SnapshotError('bad-snapshot', `"${timeZone}" is not a time zone this host knows.`, '/snapshot/timeZone');
	}
}

export function openSnapshot(given: SerialisedSnapshot): OpenedSnapshot {
	const configDir = given.configDir ?? DEFAULT_CONFIG_DIR;
	const now = instant(given.now);
	checkZone(given.timeZone);
	const listed = new Set(given.files);
	for (const path of Object.keys(given.contents)) {
		if (!listed.has(path)) throw new SnapshotError('bad-snapshot', `${path} has content but isn't one of the files.`, '/snapshot/contents');
	}
	const ls = given.linkSettings ?? {};
	const links: LinkConfig = { alwaysUpdateLinks: ls.alwaysUpdateLinks === true, newLinkFormat: linkFormat(ls.newLinkFormat), useMarkdownLinks: ls.useMarkdownLinks === true };
	const appJson = `${configDir}/app.json`;
	const reader: VaultReader = {
		list: () => given.files,
		read: (path) => (path === appJson ? JSON.stringify(links) : Object.prototype.hasOwnProperty.call(given.contents, path) ? (given.contents[path] ?? null) : null),
	};
	const index = new VaultIndex(reader, { configDir });
	const settings = migrateSettings(given.settings);

	const versions = given.versions;
	if (versions) {
		const missing = index.notePaths.find((path) => !Object.prototype.hasOwnProperty.call(versions, path));
		if (missing !== undefined) throw new SnapshotError('bad-snapshot', `${missing} has no version; with versions, every note needs one.`, '/snapshot/versions');
	}
	const ids = given.ids;
	let used = 0;
	const newId = ids
		? () => {
				const id = ids[used];
				if (id === undefined) throw new SnapshotError('not-enough-ids', `The operation needs more than the ${ids.length} IDs given.`, '/snapshot/ids');
				used++;
				return id;
			}
		: undefined;

	const snapshot: Snapshot = {
		...filesSnapshot(index, settings, now, given.timeZone),
		embeds: (path) => index.body(path)?.embeds.map((ref) => ref.link) ?? [],
		...(newId ? { newId } : {}),
		...(versions
			? {
					version: (path: string) => {
						if (Object.prototype.hasOwnProperty.call(versions, path)) return versions[path] ?? null;
						if (index.has(path)) throw new SnapshotError('bad-snapshot', `${path} has no version.`, '/snapshot/versions');
						return null;
					},
				}
			: {}),
		...(given.settingsVersion !== undefined ? { settingsVersion: given.settingsVersion } : {}),
	};
	return { snapshot, reader, configDir, links, idsUsed: () => used };
}
