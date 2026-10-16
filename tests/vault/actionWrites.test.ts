// editAction with a stand-in for the Obsidian API: the metadata cache can lag behind a write made just before.

import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ normalizePath: (p: string) => p, TFile: class {} }));

const { editAction } = await import('../../src/vault/actionWrites');
const { DEFAULT_SETTINGS } = await import('../../src/settings');

type Fm = Record<string, unknown>;

/** A note whose properties are `onDisk`, while the metadata cache still holds `cached`. */
function setup(cached: Fm, onDisk: Fm) {
	const matter = { path: 'MTM/Matters/Kitchen.md', basename: 'Kitchen' };
	const file = { path: 'MTM/Actions/Call.md', basename: 'Call' };
	const app = {
		vault: {
			getFileByPath: (p: string) => (p === matter.path ? matter : null),
			adapter: { read: () => Promise.resolve('---\nmtm-kind: action\n---\n') },
			process: () => Promise.resolve(''),
		},
		metadataCache: {
			getFileCache: (f: { path: string }) => (f.path === file.path ? { frontmatter: cached } : { frontmatter: { 'mtm-kind': 'matter' } }),
			getFirstLinkpathDest: (link: string) => (link === 'Kitchen' ? matter : null),
			fileToLinktext: () => 'Kitchen',
		},
		fileManager: {
			processFrontMatter: (_: unknown, change: (fm: Fm) => void) => {
				change(onDisk);
				return Promise.resolve();
			},
		},
	};
	return { app, file, fm: onDisk };
}

const base = { 'mtm-kind': 'action', 'mtm-type': 'call', 'mtm-matter': '[[Kitchen]]' };

describe('editAction', () => {
	it('decides the completion date from the properties it edits, not a stale cache', async () => {
		// Marked as done just before: the note is closed with a completion date, the cache still shows it open.
		const undo = setup({ ...base, 'mtm-status': 'next' }, { ...base, 'mtm-status': 'done', 'mtm-completed': '2026-10-09' });
		await editAction(undo.app as never, undo.file as never, DEFAULT_SETTINGS, { statusId: 'next' });
		expect(undo.fm['mtm-status']).toBe('next');
		expect(undo.fm['mtm-completed']).toBeUndefined();

		// Reopened just before: the cache still shows it closed.
		const done = setup({ ...base, 'mtm-status': 'done', 'mtm-completed': '2026-10-01' }, { ...base, 'mtm-status': 'next' });
		await editAction(done.app as never, done.file as never, DEFAULT_SETTINGS, { statusId: 'done' });
		expect(done.fm['mtm-status']).toBe('done');
		expect(typeof done.fm['mtm-completed']).toBe('string');
	});

	it('decides a move to another cell from the properties it edits', async () => {
		const moved = setup({ ...base, 'mtm-status': 'doing', 'mtm-order': 3 }, { ...base, 'mtm-status': 'next', 'mtm-order': 3 });
		await editAction(moved.app as never, moved.file as never, DEFAULT_SETTINGS, { statusId: 'doing' });
		expect(moved.fm['mtm-order']).toBeUndefined();
	});
});
