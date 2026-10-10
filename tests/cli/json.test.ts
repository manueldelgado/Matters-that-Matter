// Every command's `--json` output, pinned whole in files under __snapshots__/json/ (the vault's folder as
// `<vault>`): reads, writes, dry runs and errors. Scripts depend on these shapes.

import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { nodeFs, type ApplyFs } from '../../cli/src/apply';
import type { ContentsAfter } from '../../cli/src/filesLayer';
import type { CliIo } from '../../cli/src/main';
import { fixtureCopy, mtm, normalise, read, syntheticVault, tempDir, writeFiles } from './helpers';
import { tempContentsAfter } from './tempWriter';

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const synthetic = () => {
	const root = syntheticVault();
	made.push(dirname(root));
	return root;
};
const fixture = () => {
	const root = fixtureCopy();
	made.push(dirname(root));
	return root;
};

/** Runs a command with --json and checks its exit code; the output is pinned in a file named after the case. */
async function pinned(name: string, root: string, argv: string[], code: number, io: Partial<CliIo> = {}) {
	const r = await mtm([...argv, '--json', '--vault', root], { contentsAfter: tempContentsAfter, ...io });
	expect(r.code, `${name}: ${r.stderr}`).toBe(code);
	await expect(normalise(r.stdout, root)).toMatchFileSnapshot(join('__snapshots__', 'json', `${name}.json`));
	return r;
}

describe('reads', () => {
	it('today', () => pinned('today', fixture(), ['today'], 0));
	it('workflow', () => pinned('workflow', synthetic(), ['workflow'], 0));
	it('matters', () => pinned('matters', synthetic(), ['matters'], 0));
	it('list', () => pinned('list', synthetic(), ['list'], 0));
	it('list with done', () => pinned('list-done', synthetic(), ['list', '--done', '--matter', 'Kitchen'], 0));
	it('show', () => pinned('show', synthetic(), ['show', 'Confirm the worktop measurements'], 0));
	it('parse, with its warnings', () => pinned('parse', synthetic(), ['parse', 'Call Marco about the tiles /fax #Kitchen @Zed fri 10:00 !1'], 0));
});

describe('writes', () => {
	it('add', () => pinned('add', synthetic(), ['add', 'Ask about the gym #Gym tomorrow', '--details', 'Opening hours too', '--link', 'Some note'], 0));
	it('add, dry run', () => pinned('add-dry-run', synthetic(), ['add', 'Ring the bank', '--dry-run'], 0));
	it('update with a rename', () => pinned('update', synthetic(), ['update', 'Send the invoice', '--title', 'Send the October invoice', '--status', 'Waiting', '--waiting-on', 'Lucía'], 0));
	it('done', () => pinned('done', synthetic(), ['done', 'Send the invoice'], 0));
	it('done, already done', () => pinned('done-unchanged', synthetic(), ['done', 'Order the tiles'], 0));
	it('reopen', () => pinned('reopen', synthetic(), ['reopen', 'Order the tiles'], 0));
	it('add-matter', () => pinned('add-matter', synthetic(), ['add-matter', 'Garden shed', '--sphere', 'Home', '--review-every', '1m'], 0));
	it('open', () => pinned('open', synthetic(), ['open', 'Send the invoice'], 0, { opener: () => Promise.resolve() }));
});

describe('errors', () => {
	it('ambiguous', () => pinned('error-ambiguous', synthetic(), ['show', 'Call Marco'], 1));
	it('unmatched', () => pinned('error-unmatched', synthetic(), ['update', 'Send the invoice', '--status', 'Someday'], 1));
	it('not found', () => pinned('error-not-found', synthetic(), ['done', 'Nothing like it'], 1));
	it('invalid', () => pinned('error-invalid', synthetic(), ['update', 'Send the invoice', '--priority', 'urgent'], 1));
	it('usage', () => pinned('error-usage', synthetic(), ['today', '--colour'], 1));
	it('open failed', () => pinned('error-open-failed', synthetic(), ['open', 'Garden'], 1, { opener: () => Promise.reject(new Error('no')) }));

	it('no settings', async () => {
		const root = join(tempDir(), 'Bare');
		made.push(dirname(root));
		writeFiles(root, { '.obsidian/app.json': '{}' });
		await pinned('error-no-settings', root, ['today'], 2);
	});

	it('setup not done', async () => {
		const root = syntheticVault({ settings: { setupDone: false } });
		made.push(dirname(root));
		await pinned('error-not-set-up', root, ['add', 'Something'], 2);
	});

	it('changed while writing, twice', async () => {
		const root = synthetic();
		const racing: ContentsAfter = (plan, reader, options) => {
			const outcome = tempContentsAfter(plan, reader, options);
			writeFiles(root, { 'MTM/Actions/Send the invoice.md': `${read(root, 'MTM/Actions/Send the invoice.md')}Edited elsewhere.\n` });
			return outcome;
		};
		await pinned('error-changed', root, ['done', 'Send the invoice'], 3, { contentsAfter: racing });
	});

	it('a write that fails is put back', async () => {
		const root = synthetic();
		const fs: ApplyFs = { ...nodeFs, rename: (a, b) => (b.endsWith('Send the invoice.md') ? (() => { throw new Error('disk full'); })() : nodeFs.rename(a, b)) };
		const before = read(root, 'MTM/Actions/Send the invoice.md');
		await pinned('error-failed', root, ['done', 'Send the invoice'], 3, { fs });
		expect(read(root, 'MTM/Actions/Send the invoice.md')).toBe(before);
	});

	it('a path outside the vault', async () => {
		const outside: ContentsAfter = () => ({ files: [{ path: '../Escape.md', from: null, before: null, after: 'x\n' }], links: [], danglingLinks: 0 });
		await pinned('error-unsafe', synthetic(), ['add', 'Something'], 3, { contentsAfter: outside });
	});
});
