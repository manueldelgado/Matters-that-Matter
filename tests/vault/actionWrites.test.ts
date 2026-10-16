// editAction and renameAction with a stand-in for the Obsidian API: the metadata cache can lag behind a write made
// just before.

import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ normalizePath: (p: string) => p, TFile: class {} }));

const { editAction, renameAction } = await import('../../src/vault/actionWrites');
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

describe('renameAction', () => {
	/** An Action in `MTM/Actions` with these properties (`cached` in the metadata cache), renamed through a stand-in file manager. */
	function renaming(fm: Fm, cached: Fm = fm) {
		const file = { path: 'MTM/Actions/Call.md', basename: 'Call', parent: { path: 'MTM/Actions' } };
		const renamed: string[] = [];
		const app = {
			vault: {
				getAbstractFileByPath: (p: string) => (p === file.path ? file : null),
				getFolderByPath: () => ({ children: [file] }),
				adapter: { read: () => Promise.resolve('---\nmtm-kind: action\n---\n') },
			},
			metadataCache: { getFileCache: () => ({ frontmatter: cached }) },
			fileManager: {
				renameFile: (_: unknown, to: string) => {
					renamed.push(to);
					return Promise.resolve();
				},
				processFrontMatter: (_: unknown, change: (data: Fm) => void) => {
					change(fm);
					return Promise.resolve();
				},
			},
		};
		return { app, file, fm, renamed };
	}

	it('gives an Action without an ID one with the rename', async () => {
		const r = renaming({ ...base, 'mtm-status': 'next' });
		expect(await renameAction(r.app as never, r.file as never, 'Call Bob')).toBe(true);
		expect(r.renamed).toEqual(['MTM/Actions/Call Bob.md']);
		expect(r.fm['mtm-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	});

	it('keeps an ID already there', async () => {
		const r = renaming({ ...base, 'mtm-status': 'next', 'mtm-id': 'kept' });
		await renameAction(r.app as never, r.file as never, 'Call Bob');
		expect(r.fm['mtm-id']).toBe('kept');
	});

	it('gives none to a note whose properties lost their kind meanwhile, while the cache still shows an Action', async () => {
		const r = renaming({ related: '[[Kitchen]]' }, { ...base, 'mtm-status': 'next' });
		await renameAction(r.app as never, r.file as never, 'Call Bob');
		expect(r.fm).toEqual({ related: '[[Kitchen]]' });
	});
});
