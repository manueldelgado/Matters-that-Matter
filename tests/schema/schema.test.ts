// The JSON Schemas in schema/ describe what a tool should write. Everything the plugin writes must validate:
// settings (defaults, every preset, every migration's output), the notes setup and the sample package create,
// new Actions and Matters, and every note of the fixture vault except the edge cases listed below.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type MattersSettings } from '../../src/settings';
import { CURRENT_SCHEMA, migrateSettings } from '../../src/services/migrations';
import { PRESET_IDS, presetStatuses, presetTypes } from '../../src/services/presets';
import { isLinkTo, planSetup, type PlannedValue, type SetupChoices } from '../../src/services/setupPlan';
import { withSampleSpheres } from '../../src/services/samplePackage';
import { recognise, type ScannedAction, type ScannedMatter, type VaultScan } from '../../src/services/reconnect';
import { newActionFrontmatter, newMatterFrontmatter } from '../../src/services/notesModel';
import { applyFieldEdit } from '../../src/services/actionEdit';

const root = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(root, 'tests/fixtures/mtm-fixture');
const EDGE = 'MTM/Sample/Edge cases';

type Json = Record<string, unknown>;
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8')) as Json;
const schemas = { action: readJson('schema/action.json'), matter: readJson('schema/matter.json'), settings: readJson('schema/settings.json') };

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validators: Record<keyof typeof schemas, ValidateFunction> = {
	action: ajv.compile(schemas.action),
	matter: ajv.compile(schemas.matter),
	settings: ajv.compile(schemas.settings),
};

/** The validation errors as short lines, or [] when the value is valid. */
function errors(name: keyof typeof schemas, value: unknown): string[] {
	const validate = validators[name];
	return validate(value) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`);
}

const noteSchema = (fm: Json): 'action' | 'matter' | null => (fm['mtm-kind'] === 'action' ? 'action' : fm['mtm-kind'] === 'matter' ? 'matter' : null);

describe('the schemas', () => {
	it.each(Object.keys(schemas))('%s.json compiles in strict mode with its public $id', (name) => {
		const schema = schemas[name as keyof typeof schemas];
		expect(() => new Ajv2020({ strict: true }).compile(schema)).not.toThrow();
		expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
		expect(schema.$id).toBe(`https://matters-that-matter.app/schema/v1/${name}.json`);
	});

	it.each(Object.keys(schemas))('%s.json describes every property in words', (name) => {
		const schema = schemas[name as keyof typeof schemas];
		const defs = (schema.$defs ?? {}) as Record<string, Json>;
		const missing: string[] = [];
		// Conditions (contains, if, then, not) restate properties described elsewhere.
		const conditions = new Set(['contains', 'if', 'then', 'else', 'not']);
		const walk = (node: unknown, path: string) => {
			if (typeof node !== 'object' || node === null) return;
			const props = (node as Json).properties as Record<string, Json> | undefined;
			if (props)
				for (const [key, prop] of Object.entries(props)) {
					const ref = typeof prop.$ref === 'string' ? defs[prop.$ref.replace('#/$defs/', '')] : undefined;
					const words = prop.description ?? ref?.description;
					if (typeof words !== 'string' || words.length < 10) missing.push(`${path}/${key}`);
				}
			for (const [key, child] of Object.entries(node as Json)) if (!conditions.has(key)) walk(child, `${path}/${key}`);
		};
		walk(schema, '');
		expect(missing).toEqual([]);
		expect(typeof schema.description).toBe('string');
	});

	it('words its descriptions in the product terms', () => {
		for (const schema of Object.values(schemas)) {
			const text = JSON.stringify(schema);
			expect(text).not.toMatch(/\b(task|tasks|project|projects)\b/i);
		}
	});
});

// ——— Settings ———

const presetSettings = (id: (typeof PRESET_IDS)[number]): MattersSettings => ({
	...structuredClone(DEFAULT_SETTINGS),
	setupDone: true,
	statuses: presetStatuses(id),
	types: presetTypes(id),
});

/** Saved settings as an older version wrote them: the keys that version knew. */
function savedAt(version: number): Json {
	const added: Record<string, number> = { spheres: 2, openMattersAsOverview: 4, todayInNewTabs: 5, inlineChips: 6, linksAddActions: 7 };
	const data: Json = { ...structuredClone(DEFAULT_SETTINGS), schemaVersion: version, setupDone: true };
	for (const [key, since] of Object.entries(added)) if (version < since) delete data[key];
	return data;
}

/** The default settings at a version: linksAddActions from 7 on, absent before it. */
function settingsAt(version: number, linksAddActions = true): Json {
	const data: Json = { ...structuredClone(DEFAULT_SETTINGS), schemaVersion: version };
	if (version >= 7) data.linksAddActions = linksAddActions;
	else delete data.linksAddActions;
	return data;
}

/** Notes a reconnecting setup reads back: someone's own workflow, folders and Spheres, and a sample package under a preset. */
function scans(): [string, VaultScan][] {
	const act = (path: string, status: string, type: string, completed?: string): ScannedAction => ({ path, status, type, completed, sample: false, people: [] });
	const matter = (path: string, sphere?: string, icon = 'circle-dot'): ScannedMatter => ({ path, sphere, icon, sample: false });
	const own: VaultScan = {
		actions: [
			act('Work/Actions/a.md', 'backlog', 'email'),
			act('Work/Actions/b.md', 'in-progress', 'deep-work'),
			act('Work/Actions/c.md', 'waiting', 'phone-call'),
			act('Work/Actions/d.md', 'finished', 'email', '2026-10-01'),
			act('Work/Actions/e.md', 'dropped', 'errand', '2026-09-20'),
			act('Work/Actions/f.md', 'Odd Label', 'Café visit'),
		],
		matters: [matter('Work/Matters/Capture.md', undefined, 'inbox'), matter('Work/Matters/Clients.md', 'work'), matter('Work/Matters/Garden.md', 'family')],
		boards: ['Work/Boards/Work.base'],
	};
	const next: VaultScan = {
		actions: [act('MTM/Actions/a.md', 'someday', 'calls'), act('MTM/Actions/b.md', 'next', 'computer'), act('MTM/Actions/c.md', 'done', 'errands', '2026-10-08')],
		matters: [matter('MTM/Matters/Inbox.md', undefined, 'inbox'), matter('MTM/Matters/Kitchen.md', 'home')],
		boards: ['MTM/Boards/Matters.base'],
	};
	const bare: VaultScan = { actions: [act('Notes/x.md', '', '')], matters: [], boards: [] };
	return [
		["someone's own workflow", own],
		['the next-actions preset', next],
		['Actions without status or type', bare],
	];
}

describe('settings.json', () => {
	it('accepts the current schema version', () => {
		expect(CURRENT_SCHEMA).toBeGreaterThanOrEqual(6);
		expect(errors('settings', { ...DEFAULT_SETTINGS, schemaVersion: CURRENT_SCHEMA })).toEqual([]);
	});

	it('accepts the default settings', () => {
		expect(errors('settings', DEFAULT_SETTINGS)).toEqual([]);
	});

	it.each(PRESET_IDS)('accepts the %s preset, with and without the sample Spheres', (id) => {
		const settings = presetSettings(id);
		expect(errors('settings', settings)).toEqual([]);
		expect(errors('settings', { ...settings, spheres: withSampleSpheres(settings.spheres) })).toEqual([]);
	});

	it.each([1, 2, 3, 4, 5, 6])('accepts what migrateSettings makes of settings saved at version %i', (version) => {
		expect(errors('settings', migrateSettings(savedAt(version)))).toEqual([]);
	});

	it.each<[string, unknown]>([
		['nothing saved', undefined],
		['null', null],
		['an array', []],
		['no schema version', { setupDone: true, showDone: false }],
		['statuses without a closed one, two backlogs and a bad tone', {
			schemaVersion: 6,
			statuses: [
				{ id: 'a', label: 'A', tone: 'red', category: 'open', backlog: true },
				{ id: 'b', label: 'B', tone: 'sky', category: 'odd', backlog: true },
			],
		}],
		['types without icons or a default, duplicated', {
			schemaVersion: 6,
			types: [{ id: 'x', label: 'X' }, { id: 'x', label: 'X again' }, { id: 'y', label: 'Y', tone: 'nope' }],
		}],
		['Spheres without icons and an invalid entry', { schemaVersion: 6, spheres: [{ id: 'home', label: 'Home' }, 'work'] }],
		['an invalid new tab choice and chips setting', { schemaVersion: 6, todayInNewTabs: 'sometimes', inlineChips: 'yes' }],
	])('accepts what migrateSettings makes of %s', (_name, saved) => {
		expect(errors('settings', migrateSettings(saved))).toEqual([]);
	});

	it('accepts the fixture vault settings', () => {
		const data = readJson('tests/fixtures/mtm-fixture/.obsidian/plugins/matters-that-matter/data.json');
		expect(errors('settings', data)).toEqual([]);
		expect(errors('settings', migrateSettings(data))).toEqual([]);
	});

	it('accepts version 7 with linksAddActions, and version 6 without it', () => {
		expect(errors('settings', settingsAt(7, true))).toEqual([]);
		expect(errors('settings', settingsAt(7, false))).toEqual([]);
		expect(errors('settings', settingsAt(6))).toEqual([]);
	});

	it('refuses version 7 without linksAddActions, and version 6 with it', () => {
		const seven = settingsAt(7);
		delete seven.linksAddActions;
		expect(errors('settings', seven)).not.toEqual([]);
		expect(errors('settings', { ...settingsAt(6), linksAddActions: true })).not.toEqual([]);
		expect(errors('settings', { ...settingsAt(7), linksAddActions: 'yes' })).not.toEqual([]);
	});

	it.each(scans())('accepts the settings a reconnecting setup makes from %s', (_name, scan) => {
		const found = recognise(scan);
		const settings = {
			...structuredClone(DEFAULT_SETTINGS),
			setupDone: true,
			folders: found.folders,
			statuses: found.statuses,
			types: found.types,
			spheres: found.spheres,
			inboxPath: found.inboxPath ?? DEFAULT_SETTINGS.inboxPath,
			boardPath: found.boardPath ?? DEFAULT_SETTINGS.boardPath,
		};
		expect(errors('settings', settings)).toEqual([]);
	});

	it.each<[string, (s: Json & MattersSettings) => void]>([
		['a missing key', (s) => delete (s as Json).folders],
		['an unknown key', (s) => ((s as Json).colour = 'red')],
		['an older schema version', (s) => (s.schemaVersion = 5)],
		['two backlog statuses', (s) => (s.statuses[1]!.backlog = true)],
		['no done status', (s) => delete s.statuses[4]!.done],
		['a closed backlog status', (s) => (s.statuses[0]!.category = 'closed')],
		['a done status that is not closed', (s) => (s.statuses[4]!.category = 'active')],
		['two default types', (s) => (s.types[0]!.default = true)],
		['a tone outside the palette', (s) => ((s.types[0] as unknown as Json).tone = 'red')],
		['an empty status ID', (s) => (s.statuses[1]!.id = '')],
		['a Sphere without an icon', (s) => (s.spheres = [{ id: 'home', label: 'Home' } as never])],
		['no date language', (s) => (s.dateLanguages = [])],
		['an Inbox path that is not a note', (s) => (s.inboxPath = 'MTM/Matters/Inbox')],
	])('refuses %s', (_name, change) => {
		const settings = structuredClone(DEFAULT_SETTINGS) as Json & MattersSettings;
		change(settings);
		expect(errors('settings', settings)).not.toEqual([]);
	});
});

// ——— Notes the plugin writes ———

const choices = (over: Partial<SetupChoices>): SetupChoices => ({
	folders: { ...DEFAULT_SETTINGS.folders },
	statuses: DEFAULT_SETTINGS.statuses,
	types: DEFAULT_SETTINGS.types,
	newMatters: 'Kitchen renovation\nGarden',
	adopt: ['Notes/Running.md'],
	sample: true,
	inboxPath: DEFAULT_SETTINGS.inboxPath,
	boardPath: DEFAULT_SETTINGS.boardPath,
	baseContent: '',
	now: new Date(2026, 9, 9, 12, 0),
	...over,
});

/** A planned value as the runner writes it; a link's text is its target's name (unique in an empty vault). */
function written(value: PlannedValue): unknown {
	const link = (path: string) => `[[${path.split('/').pop()?.replace(/\.md$/, '') ?? path}]]`;
	if (Array.isArray(value)) return value.map((v) => link(v.linkTo));
	return isLinkTo(value) ? link(value.linkTo) : value;
}

describe('notes the plugin writes', () => {
	it.each(PRESET_IDS)('setup with the sample package (%s preset) writes valid Actions and Matters', (id) => {
		const plan = planSetup(choices({ statuses: presetStatuses(id), types: presetTypes(id) }), {
			exists: (p) => p === 'Notes/Running.md' || p === 'Notes',
			isMatter: () => false,
			maxLaneOrder: null,
		});
		const notes = plan.create.filter((n) => n.kind === 'action' || n.kind === 'matter' || n.kind === 'inbox');
		expect(notes.filter((n) => n.kind === 'action').length).toBeGreaterThan(30);
		for (const note of notes) {
			const fm = Object.fromEntries(Object.entries(note.frontmatter).map(([k, v]) => [k, written(v)]));
			const schema = noteSchema(fm);
			expect(schema, note.path).not.toBeNull();
			expect(errors(schema!, fm), note.path).toEqual([]);
		}
		expect(plan.modify).toHaveLength(1);
		for (const change of plan.modify) expect(errors('matter', change.add), change.path).toEqual([]);
	});

	it('a new Action and a new Matter are valid', () => {
		const action = newActionFrontmatter(
			{ statusId: 'done', typeId: 'call', matterLink: '[[Kitchen renovation]]', priority: 1, start: '2026-10-12', due: '2026-10-15T10:00', people: ['[[Marco Rossi]]'] },
			DEFAULT_SETTINGS.statuses,
			'2026-10-10',
		);
		expect(errors('action', action)).toEqual([]);
		expect(errors('matter', newMatterFrontmatter({ icon: 'house', reviewEvery: '2w', sphereId: 'home', outcome: 'A kitchen we cook in.' }, 4))).toEqual([]);
	});

	it('waiting on someone, then on no one, stays valid', () => {
		const fm: Json = { 'mtm-kind': 'action', 'mtm-type': 'call', 'mtm-status': 'waiting', 'mtm-matter': '[[Kitchen renovation]]' };
		const keyOf = (raw: unknown) => (typeof raw === 'string' ? raw : null);
		applyFieldEdit(fm, { waitingOn: { link: '[[Marco Rossi]]', key: '[[Marco Rossi]]' } }, keyOf, '2026-10-10');
		expect(fm['mtm-waiting-since']).toBe('2026-10-10');
		expect(errors('action', fm)).toEqual([]);
		applyFieldEdit(fm, { waitingOn: null }, keyOf, '2026-10-11');
		expect(errors('action', fm)).toEqual([]);
	});
});

// ——— What a writer may and may not write ———

const ACTION: Json = { 'mtm-kind': 'action', 'mtm-type': 'call', 'mtm-status': 'next', 'mtm-matter': '[[Kitchen renovation]]' };
const MATTER: Json = { 'mtm-kind': 'matter', 'mtm-icon': 'house', 'mtm-state': 'active', 'mtm-lane-order': 3 };

describe('action.json', () => {
	it.each<[string, Json]>([
		['only mtm-kind', { 'mtm-kind': 'action' }],
		['a whole-day due date', { 'mtm-due': '2026-10-15' }],
		['a timed due date and a start', { 'mtm-start': '2026-10-14T09:30', 'mtm-due': '2026-10-15T23:59' }],
		['each priority', { 'mtm-priority': 3 }],
		['a link with a folder, a heading and shown text', { 'mtm-matter': '[[MTM/Matters/Kitchen renovation#Plans|Kitchen]]' }],
		['waiting on someone', { 'mtm-waiting-on': '[[Marco Rossi]]', 'mtm-people': ['[[Marco Rossi]]', '[[Ana]]'], 'mtm-waiting-since': '2026-10-01' }],
		['a completion date', { 'mtm-status': 'done', 'mtm-completed': '2026-10-09' }],
		['an order by hand', { 'mtm-order': 25 }],
		['an ID that is not in settings', { 'mtm-status': 'someday', 'mtm-type': 'email' }],
		['properties of other plugins', { tags: ['kitchen'], aliases: ['Worktop'], status: 'whatever', 'due date': 5 }],
	])('accepts %s', (_name, extra) => {
		expect(errors('action', { ...ACTION, ...extra })).toEqual([]);
	});

	it.each<[string, Json]>([
		['another kind', { 'mtm-kind': 'task' }],
		['no kind', { 'mtm-kind': undefined }],
		['a date with seconds', { 'mtm-due': '2026-10-13T17:57:00' }],
		['a date with a space', { 'mtm-due': '2026-10-14 09:00' }],
		['a date in another order', { 'mtm-start': '15/10/2026' }],
		['a month that does not exist', { 'mtm-due': '2026-13-01' }],
		['a time zone', { 'mtm-due': '2026-10-15T10:00Z' }],
		['a time on a completion date', { 'mtm-completed': '2026-10-09T10:00' }],
		['priority 4', { 'mtm-priority': 4 }],
		['priority as a word', { 'mtm-priority': 'high' }],
		['a Matter without brackets', { 'mtm-matter': 'Kitchen renovation' }],
		['an unquoted link (read as a list)', { 'mtm-matter': [['Kitchen renovation']] }],
		['a Markdown link', { 'mtm-matter': '[Kitchen](Kitchen%20renovation.md)' }],
		['an embed', { 'mtm-waiting-on': '![[Marco Rossi]]' }],
		['an empty link', { 'mtm-matter': '[[ ]]' }],
		['a link to only a heading', { 'mtm-matter': '[[#Plans]]' }],
		['people as one link', { 'mtm-people': '[[Marco Rossi]]' }],
		['waiting since without waiting on', { 'mtm-waiting-since': '2026-10-01' }],
		['an empty status', { 'mtm-status': '' }],
		['a Matter property', { 'mtm-state': 'active' }],
		['an unknown mtm- property', { 'mtm-colour': 'red' }],
		['an mtm- property in other letter case', { 'MTM-Priority': 1 }],
	])('refuses %s', (_name, change) => {
		const fm = Object.fromEntries(Object.entries({ ...ACTION, ...change }).filter(([, v]) => v !== undefined));
		expect(errors('action', fm)).not.toEqual([]);
	});
});

describe('matter.json', () => {
	it.each<[string, Json]>([
		['only mtm-kind', { 'mtm-kind': 'matter' }],
		['the Inbox', { 'mtm-icon': 'inbox' }],
		['a review rhythm and the last review', { 'mtm-review-every': '3m', 'mtm-last-reviewed': '2026-09-27' }],
		['a Sphere and an outcome', { 'mtm-sphere': 'home', 'mtm-outcome': 'A kitchen we cook in.' }],
		['a lane order between two others', { 'mtm-lane-order': 2.5 }],
		['each state', { 'mtm-state': 'dormant' }],
		['properties of other plugins', { tags: ['home'], cssclasses: ['wide'] }],
	])('accepts %s', (_name, extra) => {
		expect(errors('matter', { ...MATTER, ...extra })).toEqual([]);
	});

	it.each<[string, Json]>([
		['another state', { 'mtm-state': 'archived' }],
		['a rhythm in years', { 'mtm-review-every': '1y' }],
		['a rhythm of zero', { 'mtm-review-every': '0w' }],
		['a rhythm with a space', { 'mtm-review-every': '2 w' }],
		['an outcome over two lines', { 'mtm-outcome': 'One\nTwo' }],
		['an empty outcome', { 'mtm-outcome': '' }],
		['a blank outcome', { 'mtm-outcome': '   ' }],
		['an mtm- property in other letter case', { 'Mtm-State': 'active' }],
		['an icon with capitals', { 'mtm-icon': 'House' }],
		['a lane order as text', { 'mtm-lane-order': 'first' }],
		['an Action property', { 'mtm-status': 'next' }],
		['an unknown mtm- property', { 'mtm-colour': 'red' }],
	])('refuses %s', (_name, change) => {
		expect(errors('matter', { ...MATTER, ...change })).not.toEqual([]);
	});
});

// ——— The fixture vault ———

/**
 * Notes the plugin reads without rewriting them, but that a tool should never write: the schemas refuse them on purpose.
 * The plugin copes with each; a writer following the schemas never produces them.
 */
const INTENTIONALLY_INVALID: Record<string, string> = {
	[`${EDGE}/Edge - due with seconds.md`]: 'seconds: what Obsidian\'s date picker writes; a writer uses YYYY-MM-DDTHH:mm',
	[`${EDGE}/Edge - due with a space.md`]: 'a space between date and time; a writer uses the T form',
	[`${EDGE}/Edge - Matter without brackets.md`]: 'a Matter named without a link; a writer writes a quoted wikilink',
	[`${EDGE}/Edge - people as one link.md`]: 'mtm-people as one link; a writer always writes a list',
};

/** Notes whose properties YAML can't read: Obsidian shows no properties, and the plugin sees no Action. */
const UNREADABLE: Record<string, string> = {
	[`${EDGE}/Edge - invalid YAML.md`]: 'an unclosed flow list',
};

/** Notes with no properties block as Obsidian reads it: not MTM notes at all, so no schema applies. */
const NO_PROPERTIES = [`${EDGE}/Edge - empty frontmatter.md`, `${EDGE}/Edge - frontmatter after a blank line.md`, `${EDGE}/Edge - frontmatter not closed.md`];

/** Every Markdown note under `dir`, relative, sorted; the configuration folder left out. */
function notesUnder(dir: string, prefix = ''): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (entry.name !== '.obsidian') out.push(...notesUnder(dir, rel));
		} else if (entry.name.endsWith('.md')) out.push(rel);
	}
	return out.sort();
}

type Properties = { kind: 'none' } | { kind: 'unreadable'; error: string } | { kind: 'read'; fm: Json };

/** The properties block as Obsidian finds it: `---` on the very first line, closed by a line of `---`; YAML 1.2. */
function properties(text: string): Properties {
	const lines = text.split(/\r?\n/);
	if (lines[0] !== '---') return { kind: 'none' };
	const end = lines.indexOf('---', 1);
	if (end < 0) return { kind: 'none' };
	try {
		const fm: unknown = parse(lines.slice(1, end).join('\n'));
		if (fm === null || fm === undefined) return { kind: 'none' };
		if (typeof fm !== 'object' || Array.isArray(fm)) return { kind: 'unreadable', error: 'not a map of properties' };
		return { kind: 'read', fm: fm as Json };
	} catch (e) {
		return { kind: 'unreadable', error: e instanceof Error ? e.message : String(e) };
	}
}

describe('the fixture vault', () => {
	const notes = notesUnder(FIXTURE).map((path) => ({ path, props: properties(readFileSync(join(FIXTURE, path), 'utf8')) }));

	it('holds every listed edge case', () => {
		const paths = new Set(notes.map((n) => n.path));
		for (const path of [...Object.keys(INTENTIONALLY_INVALID), ...Object.keys(UNREADABLE), ...NO_PROPERTIES]) expect(paths, path).toContain(path);
	});

	it('has unreadable properties only where listed', () => {
		expect(notes.filter((n) => n.props.kind === 'unreadable').map((n) => n.path)).toEqual(Object.keys(UNREADABLE));
	});

	it('has notes without properties where listed', () => {
		const none = notes.filter((n) => n.props.kind === 'none').map((n) => n.path);
		for (const path of NO_PROPERTIES) expect(none).toContain(path);
	});

	it('validates every Action and Matter note, except the intentionally invalid ones', () => {
		const failures: Record<string, string[]> = {};
		let actions = 0;
		let matters = 0;
		for (const { path, props } of notes) {
			if (props.kind !== 'read') continue;
			const schema = noteSchema(props.fm);
			if (!schema) continue;
			if (schema === 'action') actions++;
			else matters++;
			const found = errors(schema, props.fm);
			if (found.length) failures[path] = found;
		}
		expect(Object.keys(failures).sort()).toEqual(Object.keys(INTENTIONALLY_INVALID).sort());
		expect(actions).toBeGreaterThan(50);
		expect(matters).toBeGreaterThan(10);
	});

	it('names an MTM kind only on Actions and Matters', () => {
		const kinds = new Set(notes.flatMap((n) => (n.props.kind === 'read' && n.props.fm['mtm-kind'] !== undefined ? [n.props.fm['mtm-kind']] : [])));
		expect([...kinds].sort()).toEqual(['action', 'matter']);
	});
});
