// Held snapshots: every corpus request answers the same through a snapshot the core holds as through the vault handed
// over whole; a held snapshot told what changed answers as a fresh one of the changed files; the properties cache
// round-trips; and a change the core refuses leaves the snapshot as it was. Run through the built bundle.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CoreRequest, CoreResponse, SerialisedSnapshot, SnapshotCache } from '../../core/src/boundary';
import type { FileOutcome } from '../../src/files/write';
import { bundle } from './bundle';
import { expectAsSources } from './compare';
import { corpus, type CorpusEntry } from './corpus';

const core = await bundle();
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const success = (r: CoreResponse) => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r;
};
const failure = (r: CoreResponse) => {
	if (r.ok) throw new Error(`Expected a failure, got ${JSON.stringify(r).slice(0, 200)}`);
	return r.error;
};

/** Holds a vault; its handle. */
const open = (snapshot: SerialisedSnapshot, cache?: SnapshotCache): string => {
	const r = success(core.run({ op: 'openSnapshot', input: cache ? { cache } : {}, snapshot }));
	return (r.value as { handle: string }).handle;
};
const close = (handle: string) => core.run({ op: 'closeSnapshot', input: { handle } });

/** The request as it runs on a held snapshot: the clock, zone and IDs per call, the files held. */
function heldRequest(request: CoreRequest, handle: string): CoreRequest {
	const { snapshot, ...rest } = request as CoreRequest & { snapshot: SerialisedSnapshot };
	return { ...rest, held: { handle, now: snapshot.now, timeZone: snapshot.timeZone, ...(snapshot.ids ? { ids: snapshot.ids } : {}) } } as CoreRequest;
}

/** What identifies a vault apart from the clock, the zone and the IDs. */
const vaultKey = (s: SerialisedSnapshot) => JSON.stringify({ ...s, now: null, timeZone: null, ids: null });

const vaultEntries = corpus().filter((e) => e.request.op !== 'mergeNote');

describe('every corpus request through a held snapshot', () => {
	// One held snapshot per vault, with every request on it in turn: later requests reuse what earlier ones built, at
	// other moments and in other zones.
	const answers = new Map<CorpusEntry, CoreResponse>();
	const byVault = new Map<string, CorpusEntry[]>();
	for (const e of vaultEntries) {
		const key = vaultKey((e.request as { snapshot: SerialisedSnapshot }).snapshot);
		byVault.set(key, [...(byVault.get(key) ?? []), e]);
	}
	for (const group of byVault.values()) {
		const handle = open((group[0]?.request as { snapshot: SerialisedSnapshot }).snapshot);
		for (const e of group) answers.set(e, core.run(heldRequest(e.request, handle)));
		close(handle);
	}

	it('holds a few vaults, not one per request', () => {
		expect(byVault.size).toBeLessThan(vaultEntries.length / 2);
	});

	it.each(vaultEntries.map((e) => [e.name, e] as [string, CorpusEntry]))('%s', (_name, e) => {
		expectAsSources(e, answers.get(e) as CoreResponse);
	});
});

// ——— Changes ———

/** The serialised vault after the files of a plan were written. */
function written(s: SerialisedSnapshot, outcome: FileOutcome): SerialisedSnapshot {
	const files = new Set(s.files);
	const contents = { ...s.contents };
	const versions = s.versions ? { ...s.versions } : undefined;
	for (const f of outcome.files) {
		if (f.from !== null && f.from !== f.path) {
			files.delete(f.from);
			delete contents[f.from];
			if (versions) delete versions[f.from];
		}
		files.add(f.path);
		contents[f.path] = f.after;
		if (versions) versions[f.path] = sha(f.after);
	}
	return { ...s, files: [...files], contents, ...(versions ? { versions } : {}) };
}

/** The same writes as a change to a held snapshot. */
function changeOf(handle: string, outcome: FileOutcome, versions: boolean) {
	return {
		op: 'changeSnapshot' as const,
		input: {
			handle,
			renames: outcome.files.filter((f) => f.from !== null && f.from !== f.path).map((f) => ({ from: f.from as string, to: f.path })),
			files: outcome.files.map((f) => ({ path: f.path, content: f.after, ...(versions ? { version: sha(f.after) } : {}) })),
		},
	};
}

/** Reads that see the whole vault, and every written note read on its own. */
function reads(paths: string[]): { op: CoreRequest['op']; input: Record<string, unknown> }[] {
	return [
		{ op: 'getToday', input: {} },
		{ op: 'listActions', input: { done: true } },
		{ op: 'listMatters', input: {} },
		{ op: 'getWorkflow', input: {} },
		...paths.map((action) => ({ op: 'getAction' as const, input: { action } })),
	];
}

/** Every read on the held snapshot answers as on the files handed over whole. */
function expectSameReads(handle: string, fresh: SerialisedSnapshot, paths: string[]) {
	for (const read of reads(paths)) {
		const whole = core.run({ ...read, snapshot: fresh });
		const held = core.run({ ...read, held: { handle, now: fresh.now, timeZone: fresh.timeZone } });
		expect(held, `${read.op} ${JSON.stringify(read.input)}`).toEqual(whole);
	}
}

const writes = vaultEntries.filter((e) => 'apply' in e.request && e.request.apply && e.expected.result.ok);

describe('a held snapshot told what a write changed answers as the written files', () => {
	it.each(writes.map((e) => [e.name, e] as [string, CorpusEntry]))('%s', (_name, e) => {
		const before = (e.request as { snapshot: SerialisedSnapshot }).snapshot;
		const handle = open(before);
		const first = success(core.run(heldRequest(e.request, handle)));
		const outcome = first.files as FileOutcome;
		success(core.run(changeOf(handle, outcome, before.versions !== undefined)));
		const after = written(before, outcome);
		expectSameReads(handle, after, outcome.files.map((f) => f.path));
		// The same write again, on the changed vault: plans, changes and files as from the files handed over whole.
		const again = { ...e.request, snapshot: { ...after, ids: before.ids } } as CoreRequest;
		expect(core.run(heldRequest(again, handle))).toEqual(core.run(again));
		close(handle);
	});
});

const fixture = (vaultEntries.find((e) => e.request.op === 'getWorkflow')?.request as { snapshot: SerialisedSnapshot }).snapshot;
const withVersions = (s: SerialisedSnapshot): SerialisedSnapshot => ({ ...s, versions: Object.fromEntries(Object.entries(s.contents).map(([p, t]) => [p, sha(t)])) });
const notesOf = (s: SerialisedSnapshot, kind: string) => Object.keys(s.contents).filter((p) => new RegExp(`^mtm-kind: ${kind}$`, 'm').test(s.contents[p] ?? ''));
const nameOf = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/, '');
/** The Matter (not the Inbox) that the most Actions name, so a change to it reaches them. */
const busiestMatter = (s: SerialisedSnapshot): string => {
	const count = (m: string) => notesOf(s, 'action').filter((a) => (s.contents[a] ?? '').includes(`[[${nameOf(m)}]]`)).length;
	return notesOf(s, 'matter')
		.filter((p) => !p.endsWith('Inbox.md'))
		.sort((x, y) => count(y) - count(x))[0] ?? '';
};
/** The Actions that name this Matter. */
const actionsIn = (s: SerialisedSnapshot, matter: string) => notesOf(s, 'action').filter((a) => (s.contents[a] ?? '').includes(`[[${nameOf(matter)}]]`));

describe('changes of every kind', () => {
	const actions = notesOf(fixture, 'action');
	const edit = (s: SerialisedSnapshot, path: string, f: (text: string) => string): SerialisedSnapshot => ({ ...s, contents: { ...s.contents, [path]: f(s.contents[path] ?? '') } });

	/** Applies `make` to the fixture both ways and compares every read. */
	function check(make: (s: SerialisedSnapshot) => { after: SerialisedSnapshot; change: Record<string, unknown> }, paths: string[]) {
		const handle = open(fixture);
		// Settle the held view before the change, so the change has something to carry or to throw away.
		success(core.run({ op: 'getToday', input: {}, held: { handle, now: fixture.now, timeZone: fixture.timeZone } }));
		const { after, change } = make(fixture);
		success(core.run({ op: 'changeSnapshot', input: { handle, ...change } }));
		expectSameReads(handle, after, paths);
		close(handle);
	}

	it('an Action’s properties edited: the other items carried over', () => {
		const path = actions[0] ?? '';
		check((s) => {
			const after = edit(s, path, (t) => t.replace(/^mtm-status: .*$/m, 'mtm-status: done'));
			return { after, change: { files: [{ path, content: after.contents[path] }] } };
		}, [path]);
	});

	it('twenty Actions edited one after another, each change seen by the next read', () => {
		const handle = open(fixture);
		let s = fixture;
		for (const [i, path] of actions.slice(0, 20).entries()) {
			s = edit(s, path, (t) => t.replace(/^mtm-priority: .*$/m, '').replace(/^mtm-kind: action$/m, `mtm-kind: action\nmtm-priority: ${(i % 3) + 1}`));
			success(core.run({ op: 'changeSnapshot', input: { handle, files: [{ path, content: s.contents[path] }] } }));
			expectSameReads(handle, s, [path]);
		}
		close(handle);
	});

	it('a Matter’s state changed: Matters and lanes follow', () => {
		const path = busiestMatter(fixture);
		check((s) => {
			const after = edit(s, path, (t) => (/^mtm-state: /m.test(t) ? t.replace(/^mtm-state: .*$/m, 'mtm-state: dormant') : t.replace(/^mtm-kind: matter$/m, 'mtm-kind: matter\nmtm-state: dormant')));
			return { after, change: { files: [{ path, content: after.contents[path] }] } };
		}, []);
	});

	it('a Matter no longer a Matter: every Action in it follows', () => {
		const path = busiestMatter(fixture);
		check((s) => {
			const after = edit(s, path, (t) => t.replace(/^mtm-kind: matter$/m, ''));
			return { after, change: { files: [{ path, content: after.contents[path] }] } };
		}, actionsIn(fixture, path));
	});

	it('an Action no longer an Action', () => {
		const path = actions[1] ?? '';
		check((s) => {
			const after = edit(s, path, (t) => t.replace(/^mtm-kind: action$/m, ''));
			return { after, change: { files: [{ path, content: after.contents[path] }] } };
		}, [path]);
	});

	it('a note added, an attachment added and a note removed', () => {
		const gone = actions[2] ?? '';
		const added = 'MTM/Actions/Phone the plumber.md';
		check(
			(s) => {
				const contents: Record<string, string> = { ...s.contents, [added]: '---\nmtm-kind: action\nmtm-type: call\nmtm-status: next\n---\n' };
				delete contents[gone];
				const after = { ...s, files: [...s.files.filter((p) => p !== gone), added, 'MTM/Attachments/quote.pdf'], contents };
				return { after, change: { files: [{ path: added, content: contents[added] }, { path: 'MTM/Attachments/quote.pdf' }, { path: gone, removed: true }] } };
			},
			[added, gone],
		);
	});

	it('a Matter renamed, its links not yet rewritten (partial arrival)', () => {
		const from = busiestMatter(fixture);
		const to = from.replace(/([^/]+)\.md$/, '$1 renamed.md');
		check(
			(s) => {
				const contents = { ...s.contents, [to]: s.contents[from] ?? '' };
				delete contents[from];
				return { after: { ...s, files: [...s.files.filter((p) => p !== from), to], contents }, change: { renames: [{ from, to }] } };
			},
			actionsIn(fixture, from),
		);
	});

	it('there is a Matter with Actions for the changes to reach', () => {
		expect(actionsIn(fixture, busiestMatter(fixture)).length).toBeGreaterThan(2);
	});

	it('the settings changed: a status relabelled', () => {
		check((s) => {
			const settings = JSON.parse(JSON.stringify(s.settings)) as { statuses?: { label: string }[] };
			if (settings.statuses?.[0]) settings.statuses[0].label = 'Up next';
			return { after: { ...s, settings }, change: { settings } };
		}, actions.slice(0, 3));
	});

	it('the link settings changed', () => {
		check((s) => {
			const linkSettings = { newLinkFormat: 'absolute' as const, alwaysUpdateLinks: true };
			return { after: { ...s, linkSettings }, change: { linkSettings } };
		}, actions.slice(0, 3));
	});

	it('a text handed over again unchanged changes nothing', () => {
		const path = actions[0] ?? '';
		check((s) => ({ after: s, change: { files: [{ path, content: s.contents[path] }] } }), [path]);
	});
});

describe('the properties cache', () => {
	const versioned = withVersions(fixture);

	it('round-trips: a vault opened with it answers as without', () => {
		const first = open(versioned);
		const cache = success(core.run({ op: 'exportCache', input: { handle: first } })).value as SnapshotCache;
		close(first);
		expect(cache.format).toBe(1);
		expect(Object.keys(cache.notes).length).toBe(Object.keys(versioned.contents).filter((p) => p.endsWith('.md')).length);
		const handle = open(versioned, JSON.parse(JSON.stringify(cache)) as SnapshotCache);
		expectSameReads(handle, versioned, notesOf(fixture, 'action').slice(0, 10));
		close(handle);
	});

	it('is used only for notes whose version is the same', () => {
		const path = notesOf(fixture, 'action')[0] ?? '';
		const first = open(versioned);
		const cache = success(core.run({ op: 'exportCache', input: { handle: first } })).value as SnapshotCache;
		close(first);
		const changed = withVersions({ ...fixture, contents: { ...fixture.contents, [path]: (fixture.contents[path] ?? '').replace(/^mtm-status: .*$/m, 'mtm-status: done') } });
		const handle = open(changed, cache);
		expectSameReads(handle, changed, [path]);
		close(handle);
	});

	it('is empty without versions, and ignored when given without them', () => {
		const handle = open(fixture);
		expect(success(core.run({ op: 'exportCache', input: { handle } })).value).toEqual({ format: 1, notes: {} });
		close(handle);
		const cache: SnapshotCache = { format: 1, notes: { [notesOf(fixture, 'action')[0] ?? '']: { version: 'x', frontmatter: { 'mtm-kind': 'matter' }, end: null, bodyLine: 0 } } };
		const again = open(fixture, cache);
		expectSameReads(again, fixture, notesOf(fixture, 'action').slice(0, 1));
		close(again);
	});

	it('leaves out properties JSON can’t carry exactly', () => {
		const path = 'MTM/Actions/Odd numbers.md';
		const odd = withVersions({ ...fixture, files: [...fixture.files, path], contents: { ...fixture.contents, [path]: '---\nmtm-kind: action\nsize: .inf\n---\n' } });
		const handle = open(odd);
		const cache = success(core.run({ op: 'exportCache', input: { handle } })).value as SnapshotCache;
		expect(cache.notes[path]).toBeUndefined();
		close(handle);
	});
});

describe('held snapshots refuse what they can’t do, and change all or nothing', () => {
	const first = notesOf(fixture, 'action')[0] ?? '';

	it('a handle the core doesn’t hold', () => {
		expect(failure(core.run({ op: 'getToday', input: {}, held: { handle: 'nope', now: fixture.now, timeZone: fixture.timeZone } }))).toMatchObject({ code: 'unknown-snapshot', field: '/held/handle' });
		expect(failure(core.run({ op: 'changeSnapshot', input: { handle: 'nope' } }))).toMatchObject({ code: 'unknown-snapshot', field: '/input/handle' });
		expect(failure(core.run({ op: 'exportCache', input: { handle: 'nope' } }))).toMatchObject({ code: 'unknown-snapshot' });
	});

	it('closed once, gone', () => {
		const handle = open(fixture);
		expect(success(close(handle)).value).toEqual({ closed: true });
		expect(success(close(handle)).value).toEqual({ closed: false });
		expect(failure(core.run({ op: 'getToday', input: {}, held: { handle, now: fixture.now, timeZone: fixture.timeZone } }))).toMatchObject({ code: 'unknown-snapshot' });
	});

	it('a snapshot and a held one together, or neither', () => {
		const handle = open(fixture);
		expect(failure(core.run({ op: 'getToday', input: {}, snapshot: fixture, held: { handle, now: fixture.now, timeZone: fixture.timeZone } }))).toMatchObject({ code: 'bad-request', field: '/held' });
		expect(failure(core.run({ op: 'getToday', input: {} }))).toMatchObject({ code: 'bad-request', field: '/snapshot' });
		close(handle);
	});

	it('a held request’s clock, zone and IDs are checked as a snapshot’s', () => {
		const handle = open(fixture);
		expect(failure(core.run({ op: 'getToday', input: {}, held: { handle, now: '2026-10-09T10:00', timeZone: fixture.timeZone } }))).toMatchObject({ code: 'bad-snapshot', field: '/held/now' });
		expect(failure(core.run({ op: 'getToday', input: {}, held: { handle, now: fixture.now, timeZone: 'Mars/Olympus' } }))).toMatchObject({ code: 'bad-snapshot', field: '/held/timeZone' });
		expect(failure(core.run({ op: 'addMatter', input: { name: 'Garden' }, held: { handle, now: fixture.now, timeZone: fixture.timeZone, ids: [] } }))).toMatchObject({ code: 'not-enough-ids', field: '/held/ids' });
		close(handle);
	});

	it.each([
		['a rename from a file that isn’t there', { renames: [{ from: 'Nowhere.md', to: 'Somewhere.md' }] }, '/input/renames/0/from'],
		['a rename onto a file that is', { renames: [{ from: first, to: notesOf(fixture, 'matter')[0] }] }, '/input/renames/0/to'],
		['a removed file with content', { files: [{ path: first, removed: true, content: 'x' }] }, '/input/files/0'],
		['a file removed that isn’t there', { files: [{ path: 'Nowhere.md', removed: true }] }, '/input/files/0/path'],
		['a version for a vault without versions', { files: [{ path: first, content: 'x', version: 'v' }] }, '/input/files/0/version'],
	])('%s: refused, and the snapshot as it was', (_name, change, field) => {
		const handle = open(fixture);
		const before = core.run({ op: 'listActions', input: { done: true }, held: { handle, now: fixture.now, timeZone: fixture.timeZone } });
		expect(failure(core.run({ op: 'changeSnapshot', input: { handle, files: [{ path: first, content: 'changed first' }], ...change } }))).toMatchObject({ code: 'bad-request', field });
		expect(core.run({ op: 'listActions', input: { done: true }, held: { handle, now: fixture.now, timeZone: fixture.timeZone } })).toEqual(before);
		close(handle);
	});

	it('a new note without a version, in a vault with versions', () => {
		const versioned = withVersions(fixture);
		const handle = open(versioned);
		expect(failure(core.run({ op: 'changeSnapshot', input: { handle, files: [{ path: 'MTM/Actions/New.md', content: '' }] } }))).toMatchObject({ code: 'bad-snapshot' });
		close(handle);
	});
});
