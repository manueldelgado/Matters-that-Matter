import { describe, expect, it } from 'vitest';
import { addAction } from '../../src/ops/addAction';
import { markAsDone } from '../../src/ops/markAsDone';
import type { OpResult, Snapshot } from '../../src/ops/types';
import { updateAction } from '../../src/ops/updateAction';
import { vault } from './snapshot';

function ok<T>(r: OpResult<T>) {
	if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
	return r;
}

/** A snapshot whose files' versions are their paths with "@1", and whose settings are at "settings@1". */
const versioned = (): Snapshot => {
	const s = vault();
	return { ...s, version: (path) => (s.notes.some((n) => n.path === path) ? `${path}@1` : null), settingsVersion: 'settings@1' };
};

describe('what a plan was computed from', () => {
	it('a new Action: its path must still be free, and the Matter it is filed under unchanged', () => {
		const r = ok(addAction({ title: 'Order the bricks', matter: 'Kitchen renovation' }, versioned()));
		expect(r.plan.basis).toEqual([
			{ path: 'MTM/Actions/Order the bricks.md', version: null },
			{ path: 'MTM/Matters/Kitchen renovation.md', version: 'MTM/Matters/Kitchen renovation.md@1' },
		]);
		expect(r.plan.settingsVersion).toBe('settings@1');
	});

	it('an edit: the note it writes, at the version read', () => {
		const r = ok(markAsDone('Call Marco about the quote', versioned()));
		expect(r.plan.basis).toEqual([{ path: 'MTM/Actions/Call Marco about the quote.md', version: 'MTM/Actions/Call Marco about the quote.md@1' }]);
	});

	it('a rename: the note, and its new name still free', () => {
		const r = ok(updateAction({ action: 'Call Marco about the quote', title: 'Ring Marco about the quote' }, versioned()));
		expect(r.plan.basis).toEqual([
			{ path: 'MTM/Actions/Call Marco about the quote.md', version: 'MTM/Actions/Call Marco about the quote.md@1' },
			{ path: 'MTM/Actions/Ring Marco about the quote.md', version: null },
		]);
	});

	it('nothing to write: no basis', () => {
		const r = ok(markAsDone('Order the tiles', versioned()));
		expect(r.plan.basis).toBeUndefined();
	});

	it('a snapshot without versions: no basis, no settings version', () => {
		const r = ok(markAsDone('Call Marco about the quote', vault()));
		expect(r.plan.basis).toBeUndefined();
		expect(r.plan.settingsVersion).toBeUndefined();
	});
});
