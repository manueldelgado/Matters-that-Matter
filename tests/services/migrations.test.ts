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
