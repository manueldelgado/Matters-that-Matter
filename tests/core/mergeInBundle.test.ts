// The merge's own tests (tests/files/merge.test.ts), run again with the bundle's merge in place of the sources'.

import { vi } from 'vitest';
import type { MergeInput, MergeResult } from '../../src/files/merge';

vi.mock('../../src/files/merge', async () => {
	const { bundle } = await import('./bundle');
	const core = await bundle();
	return {
		mergeNote: (input: MergeInput): MergeResult => {
			const r = core.run({ op: 'mergeNote', input });
			if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
			return r.value as MergeResult;
		},
	};
});

await import('../files/merge.test');
