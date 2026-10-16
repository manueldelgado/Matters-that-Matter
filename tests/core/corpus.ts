// The corpus as requests to the core bundle, each with what the sources answer on Node: reads of the fixture vault
// (every Action, lists by every filter, today at several moments and in several zones, the Matters, the workflow,
// and requests that fail) and every write case, once as the write cases run and once with IDs and versions. The
// sources' side builds its snapshot as the command line does, so the bundle is checked against the operations as
// other tools already use them, not against its own entry point.

import { createHash } from 'node:crypto';
import { snapshotOf } from '../../cli/src/filesLayer';
import { isVaultFile, type VaultReader } from '../../src/files/index';
import { mergeNote, type MergeInput } from '../../src/files/merge';
import { contentsAfter } from '../../src/files/write';
import { addAction, addMatter, emptyPlan, getAction, getWorkflow, inputKey, listActions, listMatters, markAsDone, reopen, today, updateAction } from '../../src/ops';
import type { OpResult, Snapshot } from '../../src/ops/types';
import { migrateSettings } from '../../src/services/migrations';
import type { CoreRequest, LinkSettings, SerialisedSnapshot } from '../../core/src/boundary';
import { caseReader, CONFIG_DIR, loadCases, type WriteCase } from '../files/writeCases';

/** What the sources answer: the operation's result, and with `apply` what the files hold after its plan. */
export interface Expected {
	result: OpResult<unknown>;
	files?: unknown;
}

export interface CorpusEntry {
	name: string;
	request: CoreRequest;
	expected: Expected;
}

const SETTINGS_FILE = `${CONFIG_DIR}/plugins/matters-that-matter/data.json`;
export const HOST_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The fixture as it is committed. */
const fixtureReader = (): VaultReader => caseReader({ name: 'fixture', op: 'addAction', input: {}, now: '' });

interface Options {
	now: Date;
	timeZone: string;
	ids?: string[];
	versions?: boolean;
}

function settingsOf(reader: VaultReader): { raw: Record<string, unknown>; text: string } {
	const text = reader.read(SETTINGS_FILE) ?? '{}';
	return { raw: JSON.parse(text) as Record<string, unknown>, text };
}

/** The vault as a caller of the bundle hands it over. */
export function serialise(reader: VaultReader, o: Options): SerialisedSnapshot {
	const files = [...reader.list()];
	const contents: Record<string, string> = {};
	for (const path of files) if (path.endsWith('.md') && isVaultFile(path, CONFIG_DIR)) contents[path] = reader.read(path) ?? '';
	const app = JSON.parse(reader.read(`${CONFIG_DIR}/app.json`) ?? '{}') as Record<string, unknown>;
	const linkSettings: LinkSettings = { alwaysUpdateLinks: app.alwaysUpdateLinks === true, useMarkdownLinks: app.useMarkdownLinks === true };
	if (app.newLinkFormat === 'shortest' || app.newLinkFormat === 'relative' || app.newLinkFormat === 'absolute') linkSettings.newLinkFormat = app.newLinkFormat;
	const settings = settingsOf(reader);
	return {
		files,
		contents,
		settings: settings.raw,
		linkSettings,
		now: o.now.toISOString(),
		timeZone: o.timeZone,
		...(o.versions ? { versions: Object.fromEntries(Object.entries(contents).map(([p, t]) => [p, sha(t)])), settingsVersion: sha(settings.text) } : {}),
		...(o.ids ? { ids: o.ids } : {}),
	};
}

/** The sources' snapshot of the same vault, as the command line builds it. */
function sourcesSnapshot(reader: VaultReader, o: Options): Snapshot {
	const settings = settingsOf(reader);
	const queue = [...(o.ids ?? [])];
	const newId = o.ids
		? () => {
				const id = queue.shift();
				if (id === undefined) throw new Error('Out of IDs');
				return id;
			}
		: null;
	const s = snapshotOf(reader, CONFIG_DIR, migrateSettings(settings.raw), o.now, newId, o.versions ? sha(settings.text) : undefined);
	// The command line names no zone; the snapshot type takes one.
	return { ...s, timeZone: o.timeZone, ...(o.versions ? {} : { version: undefined }) };
}

type Run = (s: Snapshot) => OpResult<unknown>;

function sourcesRun(request: CoreRequest, s: Snapshot): Run {
	switch (request.op) {
		case 'addAction':
			return () => addAction(request.input, s);
		case 'updateAction':
			return () => updateAction(request.input, s);
		case 'markAsDone':
			return () => markAsDone(request.input.action, s);
		case 'reopenAction':
			return () => reopen(request.input.action, s);
		case 'getAction':
			return () => getAction(request.input.action, s);
		case 'listActions':
			return () => listActions(request.input, s);
		case 'getToday':
			return () => today(s);
		case 'addMatter':
			return () => addMatter(request.input, s);
		case 'listMatters':
			return () => listMatters(s);
		case 'getWorkflow':
			return () => getWorkflow(s);
		case 'mergeNote':
			throw new Error('No snapshot for a merge');
	}
}

function entry(name: string, reader: VaultReader, o: Options, make: (snapshot: SerialisedSnapshot) => CoreRequest): CorpusEntry {
	const request = make(serialise(reader, o));
	const s = sourcesSnapshot(reader, o);
	const result = sourcesRun(request, s)(s);
	const apply = 'apply' in request && request.apply === true;
	const files = apply && result.ok ? contentsAfter(result.plan, reader, { configDir: CONFIG_DIR }) : undefined;
	return { name, request, expected: { result, ...(files ? { files } : {}) } };
}

/** A moment, local time on this machine, as the write cases give it. */
const local = (text: string) => new Date(text);

const READ_MOMENTS = ['2026-10-09T12:00', '2026-10-20T08:30', '2027-01-01T00:15'];
const ZONES = [HOST_ZONE, 'Pacific/Auckland', 'America/Los_Angeles'];

function readEntries(): CorpusEntry[] {
	const reader = fixtureReader();
	const out: CorpusEntry[] = [];
	const at = (now: string, timeZone = HOST_ZONE): Options => ({ now: local(now), timeZone });
	const s = sourcesSnapshot(reader, at(READ_MOMENTS[0] ?? ''));
	const actions = s.notes.filter((n) => n.frontmatter?.['mtm-kind'] === 'action').map((n) => n.path);
	const matters = s.notes.filter((n) => n.frontmatter?.['mtm-kind'] === 'matter').map((n) => n.basename);
	const people = s.notes.filter((n) => n.path.includes('/People/')).map((n) => n.basename);
	const { statuses, types, spheres } = s.settings;

	for (const now of READ_MOMENTS) {
		for (const timeZone of ZONES) {
			out.push(entry(`today ${now} ${timeZone}`, reader, at(now, timeZone), (snapshot) => ({ op: 'getToday', input: {}, snapshot })));
			out.push(entry(`list ${now} ${timeZone}`, reader, at(now, timeZone), (snapshot) => ({ op: 'listActions', input: { done: true }, snapshot })));
		}
		out.push(entry(`matters ${now}`, reader, at(now), (snapshot) => ({ op: 'listMatters', input: {}, snapshot })));
	}
	const o = at(READ_MOMENTS[0] ?? '');
	out.push(entry('workflow', reader, o, (snapshot) => ({ op: 'getWorkflow', input: {}, snapshot })));
	for (const action of actions) out.push(entry(`get ${action}`, reader, o, (snapshot) => ({ op: 'getAction', input: { action }, snapshot })));
	// By title, without `.md`, and names that find nothing or more than one.
	for (const action of [...actions.slice(0, 5).map((p) => p.split('/').pop()?.replace(/\.md$/, '') ?? p), 'MTM/Sample/Actions/Nothing here', 'Call', '']) {
		out.push(entry(`get by name ${action}`, reader, o, (snapshot) => ({ op: 'getAction', input: { action }, snapshot })));
	}
	const filters: Record<string, unknown>[] = [
		{},
		{ waiting: true },
		{ dueFrom: '2026-10-01', dueTo: '2026-10-31' },
		{ dueFrom: 'today' },
		{ dueTo: 'next friday', done: true },
		{ dueFrom: '2026-13-40' },
		...matters.map((matter) => ({ matter })),
		...statuses.map((st) => ({ status: st.label })),
		...types.map((t) => ({ type: t.id })),
		...spheres.map((sp) => ({ sphere: sp.label })),
		...people.map((person) => ({ person })),
		{ status: 'No such status' },
		{ matter: 'No such Matter' },
	];
	for (const input of filters) out.push(entry(`list ${JSON.stringify(input)}`, reader, o, (snapshot) => ({ op: 'listActions', input, snapshot })));
	return out;
}

/** The write case's input as the operations take it (camelCase keys). */
const inputOf = (c: WriteCase) => Object.fromEntries(Object.entries(c.input).map(([k, v]) => [inputKey(k), v]));

function writeRequest(c: WriteCase, snapshot: SerialisedSnapshot): CoreRequest {
	const input = inputOf(c);
	switch (c.op) {
		case 'addAction':
			return { op: 'addAction', input, snapshot, apply: true };
		case 'updateAction':
			return { op: 'updateAction', input: input as { action: string }, snapshot, apply: true };
		case 'markAsDone':
			return { op: 'markAsDone', input: { action: String(input.action) }, snapshot, apply: true };
		case 'reopen':
			return { op: 'reopenAction', input: { action: String(input.action) }, snapshot, apply: true };
		case 'addMatter':
			return { op: 'addMatter', input: input as { name: string }, snapshot, apply: true };
	}
}

const IDS = ['6f1c2d3e-0000-4000-8000-000000000001', '6f1c2d3e-0000-4000-8000-000000000002', '6f1c2d3e-0000-4000-8000-000000000003', '6f1c2d3e-0000-4000-8000-000000000004'];

function writeEntries(): CorpusEntry[] {
	return loadCases().flatMap((c) => {
		const reader = caseReader(c);
		const o: Options = { now: local(c.now), timeZone: HOST_ZONE };
		return [
			entry(`write ${c.name}`, reader, o, (snapshot) => writeRequest(c, snapshot)),
			entry(`write ${c.name} with IDs and versions`, reader, { ...o, ids: IDS, versions: true }, (snapshot) => writeRequest(c, snapshot)),
		];
	});
}

/** The same line in every line ending the note uses (its first). */
const eolOf = (text: string) => /\r\n|\r|\n/.exec(text)?.[0] ?? '\n';

/** Edits two writers might make apart, as text: each gives the two sides from the base. */
const EDITS: Record<string, (base: string) => [ours: string, theirs: string]> = {
	'status and priority apart': (b) => [b.replace(/mtm-status: .*/, 'mtm-status: done'), b.replace(/mtm-priority: .*/, 'mtm-priority: 3')],
	'status both ways': (b) => [b.replace(/mtm-status: .*/, 'mtm-status: done'), b.replace(/mtm-status: .*/, 'mtm-status: waiting')],
	'a tick and a new item': (b) => [b.replace('- [ ]', '- [x]'), `${b}${eolOf(b)}- [ ] Added on the other side${eolOf(b)}`],
	'lines added at the end on both': (b) => [`${b}${eolOf(b)}Ours, at the end.${eolOf(b)}`, `${b}${eolOf(b)}Theirs, at the end.${eolOf(b)}`],
	'the first line changed on one side': (b) => {
		const lines = b.split(eolOf(b));
		const at = lines.findIndex((l, i) => i > 0 && l.trim() !== '' && !l.startsWith('mtm-') && l !== '---');
		if (at >= 0) lines[at] = `${lines[at] ?? ''} (edited)`;
		return [lines.join(eolOf(b)), b];
	},
};

function mergeEntries(): CorpusEntry[] {
	const reader = fixtureReader();
	const notes = [...reader.list()].filter((p) => p.endsWith('.md') && isVaultFile(p, CONFIG_DIR));
	return notes.flatMap((path) => {
		const base = reader.read(path) ?? '';
		return Object.entries(EDITS).flatMap(([edit, make]) => {
			const [ours, theirs] = make(base);
			const inputs: [string, MergeInput][] = [
				[`merge ${path}: ${edit}`, { base, ours, theirs, later: 'theirs' }],
				[`merge ${path}: ${edit}, ours later, no base`, { base: null, ours, theirs, later: 'ours' }],
			];
			return inputs.map(([name, input]): CorpusEntry => ({
				name,
				request: { op: 'mergeNote', input },
				expected: { result: { ok: true, value: mergeNote(input), plan: emptyPlan(), changes: [], warnings: [] } },
			}));
		});
	});
}

/** Every request of the corpus, with the sources' answer. */
export function corpus(): CorpusEntry[] {
	return [...readEntries(), ...writeEntries(), ...mergeEntries()];
}
