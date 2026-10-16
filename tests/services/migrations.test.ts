import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { CURRENT_SCHEMA, migrateSettings } from '../../src/services/migrations';
import { checkFlags } from '../../src/model/workflow';

describe('migrateSettings', () => {
	it('returns defaults for a first run', () => {
		expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(migrateSettings('garbage')).toEqual(DEFAULT_SETTINGS);
	});

	it('returns a copy, never the defaults object', () => {
		const s = migrateSettings(null);
		s.statuses.push({ id: 'x', label: 'X', tone: 'ink', category: 'open' });
		expect(DEFAULT_SETTINGS.statuses).toHaveLength(5);
	});

	it('keeps saved values and fills in missing keys', () => {
		const s = migrateSettings({ schemaVersion: 1, setupDone: true, folders: { actions: 'Work/Actions' } });
		expect(s.setupDone).toBe(true);
		expect(s.folders).toEqual({ ...DEFAULT_SETTINGS.folders, actions: 'Work/Actions' });
		expect(s.weekStart).toBe('monday');
		expect(s.schemaVersion).toBe(CURRENT_SCHEMA);
	});

	it('falls back to default statuses and types when they are unusable', () => {
		const s = migrateSettings({ statuses: [], types: [{ nope: true }] });
		expect(s.statuses).toEqual(DEFAULT_SETTINGS.statuses);
		expect(s.types).toEqual(DEFAULT_SETTINGS.types);
	});

	it('repairs broken flags', () => {
		const s = migrateSettings({ statuses: DEFAULT_SETTINGS.statuses.map((x) => ({ ...x, backlog: false })) });
		expect(checkFlags(s.statuses, s.types)).toEqual([]);
	});

	it('adds an empty Sphere list from schema 1, and keeps valid Spheres', () => {
		expect(migrateSettings({ schemaVersion: 1, setupDone: true }).spheres).toEqual([]);
		const s = migrateSettings({ schemaVersion: 2, spheres: [{ id: 'home', label: 'Home', icon: 'house' }, { id: 'x', label: 'X' }, { nope: 1 }] });
		expect(s.spheres).toEqual([
			{ id: 'home', label: 'Home', icon: 'house' },
			{ id: 'x', label: 'X', icon: 'circle-dot' },
		]);
	});

	it('keeps data from a newer schema', () => {
		expect(migrateSettings({ schemaVersion: CURRENT_SCHEMA + 1 }).schemaVersion).toBe(CURRENT_SCHEMA + 1);
	});
});

describe('settings repair', () => {
	it('fills in a missing category, tone and icon and drops duplicate IDs', () => {
		const s = migrateSettings({
			schemaVersion: 3,
			statuses: [{ id: 'a', label: 'A' }, { id: 'a', label: 'Again' }, { id: 'z', label: 'Z', category: 'closed', tone: 'mint' }],
			types: [{ id: 't', label: 'T' }],
		});
		expect(s.statuses.map((x) => `${x.id}:${x.category}:${x.tone}`)).toEqual(['a:open:ink', 'z:closed:mint']);
		expect(s.types[0]).toMatchObject({ id: 't', icon: 'circle-dot', tone: 'ink', default: true });
		expect(checkFlags(s.statuses, s.types)).toEqual([]);
	});

	it('adds a Done status when none is closed, keeping the other IDs', () => {
		const s = migrateSettings({ schemaVersion: 3, statuses: [{ id: 'todo', label: 'To do', category: 'open', tone: 'sky' }] });
		expect(s.statuses.map((x) => x.id)).toEqual(['todo', 'done']);
		expect(checkFlags(s.statuses, s.types)).toEqual([]);
	});
});

describe('schema 4', () => {
	it('turns on opening Matters as their overview for settings from schema 3', () => {
		const s = migrateSettings({ schemaVersion: 3, setupDone: true });
		expect(s.openMattersAsOverview).toBe(true);
		expect(s.schemaVersion).toBe(CURRENT_SCHEMA);
	});

	it('keeps the choice once made', () => {
		expect(migrateSettings({ schemaVersion: 4, openMattersAsOverview: false }).openMattersAsOverview).toBe(false);
	});
});

describe('schema 5', () => {
	it('shows Today in every new tab for settings from schema 4', () => {
		expect(migrateSettings({ schemaVersion: 4, setupDone: true }).todayInNewTabs).toBe('every');
	});

	it('keeps a valid choice and repairs an invalid one', () => {
		expect(migrateSettings({ schemaVersion: 5, todayInNewTabs: 'alone' }).todayInNewTabs).toBe('alone');
		expect(migrateSettings({ schemaVersion: 5, todayInNewTabs: 'sometimes' }).todayInNewTabs).toBe('every');
	});
});


describe('schema 6', () => {
	it('turns chips for links to Actions on for settings from schema 5', () => {
		const s = migrateSettings({ schemaVersion: 5, setupDone: true });
		expect(s.inlineChips).toBe(true);
		expect(s.schemaVersion).toBe(7);
	});

	it('keeps a choice and repairs a value that is not true or false', () => {
		expect(migrateSettings({ schemaVersion: 6, inlineChips: false }).inlineChips).toBe(false);
		expect(migrateSettings({ schemaVersion: 6, inlineChips: 'yes' }).inlineChips).toBe(true);
	});
});

describe('schema 7', () => {
	it('lets links add Actions for settings from schema 6', () => {
		const s = migrateSettings({ schemaVersion: 6, setupDone: true, inlineChips: false });
		expect(s.linksAddActions).toBe(true);
		expect(s.inlineChips).toBe(false);
		expect(s.schemaVersion).toBe(7);
	});

	it('keeps a choice already made, through the step and after it', () => {
		expect(migrateSettings({ schemaVersion: 6, linksAddActions: false }).linksAddActions).toBe(false);
		expect(migrateSettings({ schemaVersion: 7, linksAddActions: false }).linksAddActions).toBe(false);
	});

	it.each([['a string', 'no'], ['a number', 0], ['null', null], ['missing', undefined]])('repairs %s to on', (_name, value) => {
		expect(migrateSettings({ schemaVersion: 7, linksAddActions: value }).linksAddActions).toBe(true);
		expect(migrateSettings({ schemaVersion: 6, linksAddActions: value }).linksAddActions).toBe(true);
	});

	it('is on in the defaults', () => {
		expect(DEFAULT_SETTINGS.linksAddActions).toBe(true);
	});
});

describe('date languages', () => {
	it.each([
		['missing', undefined, ['en', 'es']],
		['not a list', 'en', ['en', 'es']],
		['empty', [], ['en', 'es']],
		['only unknown languages', ['fr', 'de'], ['en', 'es']],
		['not strings', [1, null, { en: true }], ['en', 'es']],
		['English only', ['en'], ['en']],
		['Spanish only', ['es'], ['es']],
		['duplicated', ['es', 'es'], ['es']],
		['an unknown one beside a known one', ['fr', 'en'], ['en']],
		['in another order', ['es', 'en'], ['en', 'es']],
	])('repairs %s', (_name, dateLanguages, expected) => {
		expect(migrateSettings({ schemaVersion: CURRENT_SCHEMA, dateLanguages }).dateLanguages).toEqual(expected);
	});

	it('repairs without a schema change', () => {
		expect(migrateSettings({ schemaVersion: CURRENT_SCHEMA, dateLanguages: [] }).schemaVersion).toBe(CURRENT_SCHEMA);
	});
});

describe('scalar settings repair', () => {
	it('repairs values of the wrong type or outside their choices to the defaults', () => {
		const s = migrateSettings({
			schemaVersion: CURRENT_SCHEMA,
			inboxPath: 5,
			boardPath: null,
			folders: { matters: 3, actions: ['x'], boards: 'Work/Boards' },
			weekStart: 'Sunday',
			defaultInboxPosition: 'middle',
			showDone: 'no',
			setupDone: 1,
			openMattersAsOverview: 'yes',
			inlineChips: 0,
			linksAddActions: 'false',
			todayInNewTabs: 'sometimes',
			dateLanguages: 'es',
		});
		expect(s.inboxPath).toBe(DEFAULT_SETTINGS.inboxPath);
		expect(s.boardPath).toBe(DEFAULT_SETTINGS.boardPath);
		expect(s.folders).toEqual({ ...DEFAULT_SETTINGS.folders, boards: 'Work/Boards' });
		expect(s.weekStart).toBe('monday');
		expect(s.defaultInboxPosition).toBe('top');
		expect(s.showDone).toBe(true);
		expect(s.setupDone).toBe(false);
		expect(s.openMattersAsOverview).toBe(true);
		expect(s.inlineChips).toBe(true);
		expect(s.linksAddActions).toBe(true);
		expect(s.todayInNewTabs).toBe('every');
		expect(s.dateLanguages).toEqual(['en', 'es']);
	});

	it('keeps every valid value', () => {
		const saved = {
			schemaVersion: CURRENT_SCHEMA,
			setupDone: true,
			folders: { matters: 'A/M', actions: 'A/A', boards: 'A/B', people: '' },
			inboxPath: 'A/M/Tray.md',
			boardPath: 'A/B/Board.base',
			defaultInboxPosition: 'bottom' as const,
			showDone: false,
			weekStart: 'sunday' as const,
			dateLanguages: ['es' as const],
			openMattersAsOverview: false,
			todayInNewTabs: 'alone' as const,
			inlineChips: false,
			linksAddActions: false,
		};
		expect(migrateSettings(saved)).toMatchObject(saved);
	});

	it('drops duplicate Sphere IDs, keeping the first', () => {
		const s = migrateSettings({
			schemaVersion: CURRENT_SCHEMA,
			spheres: [
				{ id: 'home', label: 'Home', icon: 'house' },
				{ id: 'work', label: 'Work', icon: 'briefcase' },
				{ id: 'home', label: 'Home again', icon: 'tent' },
			],
		});
		expect(s.spheres.map((x) => `${x.id}:${x.label}`)).toEqual(['home:Home', 'work:Work']);
	});

	it('is idempotent', () => {
		const once = migrateSettings({ schemaVersion: 3, inboxPath: 5, weekStart: 'x', spheres: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] });
		expect(migrateSettings(once)).toEqual(once);
	});
});
