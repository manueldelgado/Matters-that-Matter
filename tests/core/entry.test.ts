// The bundle's boundary: requests read and checked, failures returned as values (never thrown), the boundary
// version, the snapshot's own checks, IDs and versions, and applying a plan. Run through the built bundle.

import { describe, expect, it } from 'vitest';
import type { CoreResponse, SerialisedSnapshot } from '../../core/src/boundary';
import { bundle } from './bundle';

const core = await bundle();

const ACTION = 'MTM/Actions/Call Marco.md';
const vault = (over: Partial<SerialisedSnapshot> = {}): SerialisedSnapshot => ({
	files: ['MTM/Matters/Inbox.md', 'MTM/Matters/Kitchen.md', ACTION, 'MTM/People/Marco Rossi.md', 'MTM/Attachments/plan.png'],
	contents: {
		'MTM/Matters/Inbox.md': '---\nmtm-kind: matter\n---\n',
		'MTM/Matters/Kitchen.md': '---\nmtm-kind: matter\nmtm-icon: cooking-pot\nmtm-state: active\n---\n',
		[ACTION]: '---\nmtm-kind: action\nmtm-type: call\nmtm-status: !!str next\nmtm-matter: "[[Kitchen]]"\n---\nAbout the worktop.\n\n![[plan.png]]\n',
		'MTM/People/Marco Rossi.md': '',
	},
	settings: { setupDone: true },
	now: '2026-10-09T10:00:00Z',
	timeZone: 'Europe/Madrid',
	...over,
});
const failure = (r: CoreResponse) => {
	if (r.ok) throw new Error(`Expected a failure, got ${JSON.stringify(r).slice(0, 200)}`);
	return r.error;
};
const success = (r: CoreResponse) => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r;
};

describe('requests that can’t be read come back as values', () => {
	it.each([
		['not text', 5],
		['not JSON', '{"op":'],
		['JSON that isn’t an object', '[1, 2]'],
		['null', 'null'],
	])('%s: bad-request', (_name, given) => {
		const r = JSON.parse(core.call(given as string)) as CoreResponse;
		expect(r).toMatchObject({ boundary: 1, ok: false, error: { code: 'bad-request' } });
	});

	it('an unknown operation names the ones there are', () => {
		const e = failure(core.run({ op: 'deleteEverything', input: {}, snapshot: vault() }));
		expect(e).toMatchObject({ code: 'bad-request', field: '/op' });
		expect(e.message).toContain('"addAction"');
		expect(e.message).toContain('"mergeNote"');
	});

	it('a missing snapshot, a field of the wrong type and an unknown field name their place', () => {
		expect(failure(core.run({ op: 'getToday', input: {} }))).toMatchObject({ code: 'bad-request', field: '/snapshot', message: '/snapshot is required.' });
		expect(failure(core.run({ op: 'addAction', input: { title: 5 }, snapshot: vault() }))).toMatchObject({ field: '/input/title', message: '/input/title must be string, not number.' });
		expect(failure(core.run({ op: 'addAction', input: { colour: 'red' }, snapshot: vault() }))).toMatchObject({ field: '/input/colour', message: '/input/colour is not a known field.' });
		expect(failure(core.run({ op: 'getToday', input: { x: 1 }, snapshot: vault() }))).toMatchObject({ field: '/input/x' });
		expect(failure(core.run({ op: 'updateAction', input: { action: ACTION, due: 5 }, snapshot: vault() }))).toMatchObject({ field: '/input/due', message: '/input/due must be string or null, not number.' });
		expect(failure(core.run({ op: 'getToday', input: {}, snapshot: { ...vault(), files: 'all' } }))).toMatchObject({ field: '/snapshot/files' });
	});

	it('a request for another boundary version is refused; this one’s is taken', () => {
		expect(failure(core.run({ op: 'getWorkflow', input: {}, snapshot: vault(), boundary: 2 }))).toMatchObject({ code: 'unsupported-boundary', value: '2' });
		expect(core.run({ op: 'getWorkflow', input: {}, snapshot: vault(), boundary: 1 }).ok).toBe(true);
	});

	it('every response carries the boundary version, and failures the operation when it could be read', () => {
		expect(core.run({ op: 'getWorkflow', input: {}, snapshot: vault() })).toMatchObject({ boundary: 1, ok: true, op: 'getWorkflow' });
		expect(core.run({ op: 'getAction', input: { action: 'Nobody' }, snapshot: vault() })).toMatchObject({ boundary: 1, ok: false, op: 'getAction', error: { code: 'not-found' } });
	});
});

describe('the snapshot', () => {
	it('needs an instant with a zone, and a time zone the host knows', () => {
		expect(failure(core.run({ op: 'getToday', input: {}, snapshot: vault({ now: '2026-10-09T10:00' }) }))).toMatchObject({ code: 'bad-snapshot', field: '/snapshot/now' });
		expect(failure(core.run({ op: 'getToday', input: {}, snapshot: vault({ now: 'yesterday' }) }))).toMatchObject({ code: 'bad-snapshot' });
		expect(failure(core.run({ op: 'getToday', input: {}, snapshot: vault({ timeZone: 'Mars/Olympus' }) }))).toMatchObject({ code: 'bad-snapshot', field: '/snapshot/timeZone' });
	});

	it('reads today in its time zone: late on the 9th in UTC is already the 10th in Auckland', () => {
		const at = (timeZone: string) => success(core.run({ op: 'getToday', input: {}, snapshot: vault({ now: '2026-10-09T13:00:00Z', timeZone }) })).value as { date: string };
		expect(at('Europe/London').date).toBe('2026-10-09');
		expect(at('Pacific/Auckland').date).toBe('2026-10-10');
	});

	it('refuses content for a file it doesn’t list', () => {
		const v = vault();
		expect(failure(core.run({ op: 'getToday', input: {}, snapshot: { ...v, contents: { ...v.contents, 'Elsewhere.md': 'x' } } }))).toMatchObject({ code: 'bad-snapshot', field: '/snapshot/contents' });
	});

	it('reads links, embeds and properties from the content, and resolves them over the files', () => {
		const detail = success(core.run({ op: 'getAction', input: { action: 'Call Marco' }, snapshot: vault() })).value as { attachments: { path: string }[]; matter: { name: string }; status: { id: string } };
		expect(detail.attachments).toEqual([{ path: 'MTM/Attachments/plan.png', name: 'plan.png' }]);
		expect(detail.matter.name).toBe('Kitchen');
		expect(detail.status.id).toBe('next');
	});

	it('with versions, needs one for every note, and records them as the plan’s basis', () => {
		const v = vault();
		const versions = Object.fromEntries(Object.keys(v.contents).map((p, i) => [p, `v${i}`]));
		const { [ACTION]: _left, ...missing } = versions;
		expect(failure(core.run({ op: 'markAsDone', input: { action: ACTION }, snapshot: { ...v, versions: missing } }))).toMatchObject({ code: 'bad-snapshot', field: '/snapshot/versions' });
		const r = success(core.run({ op: 'addAction', input: { title: 'Order the tiles', matter: 'Kitchen' }, snapshot: { ...v, versions, settingsVersion: 's1' } }));
		expect(r.plan.basis).toEqual(
			expect.arrayContaining([
				{ path: 'MTM/Actions/Order the tiles.md', version: null },
				{ path: 'MTM/Matters/Kitchen.md', version: 'v1' },
			]),
		);
		expect(r.plan.settingsVersion).toBe('s1');
	});

	it('takes IDs in order, says how many it used, and fails when they run out', () => {
		const add = (ids: string[]) => core.run({ op: 'addAction', input: { title: 'Order the tiles' }, snapshot: vault({ ids }) });
		const [first, second] = ['0d9b2c4e-8f1a-4c3b-9e2d-1a2b3c4d5e6f', '1e0c3d5f-9a2b-4d4c-8f3e-2b3c4d5e6f70'];
		const r = success(add([first, second]));
		expect(r.idsUsed).toBe(1);
		expect(r.plan.creates[0]?.frontmatter).toContainEqual(['mtm-id', first]);
		expect((r.value as { action: { id: string } }).action.id).toBe(first);
		expect(failure(add(['id-1']))).toMatchObject({ code: 'bad-request', field: '/snapshot/ids/0' });
		expect(failure(add([]))).toMatchObject({ code: 'not-enough-ids', field: '/snapshot/ids' });
		expect(success(core.run({ op: 'addAction', input: { title: 'Order the tiles' }, snapshot: vault() })).plan.creates[0]?.frontmatter.some(([k]) => k === 'mtm-id')).toBe(false);
	});
});

describe('applying a plan', () => {
	it('gives every file’s content after the plan, only when asked', () => {
		const asked = success(core.run({ op: 'addAction', input: { title: 'Order the tiles', link: 'https://example.com/tiles?a=1 b' }, snapshot: vault(), apply: true }));
		expect(asked.files?.files.map((f) => [f.path, f.after])).toEqual([['MTM/Actions/Order the tiles.md', expect.stringContaining('<https://example.com/tiles?a=1%20b>')]]);
		expect(success(core.run({ op: 'addAction', input: { title: 'Order the tiles' }, snapshot: vault() })).files).toBeUndefined();
	});

	it('a plan the files layer can’t apply is a write-failed failure, naming the file', () => {
		// The status is written with a tag, which an edit in place can't keep as it reads.
		expect(failure(core.run({ op: 'markAsDone', input: { action: ACTION }, snapshot: vault(), apply: true }))).toMatchObject({ code: 'write-failed', writeCode: 'invalid-properties', path: ACTION });
		expect(core.run({ op: 'markAsDone', input: { action: ACTION }, snapshot: vault() }).ok).toBe(true);
	});
});

describe('merging', () => {
	it('needs no snapshot, and checks its input', () => {
		expect(success(core.run({ op: 'mergeNote', input: { base: 'a\n', ours: 'a\nb\n', theirs: 'a\n', later: 'theirs' } })).value).toEqual({ content: 'a\nb\n', decisions: [] });
		expect(failure(core.run({ op: 'mergeNote', input: { base: 'a\n', ours: 'a\n', theirs: 'a\n', later: 'both' } }))).toMatchObject({ code: 'bad-request', field: '/input/later' });
	});
});
