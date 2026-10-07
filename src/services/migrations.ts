// Settings loading: schema migrations, defaults for missing keys, and flag repair.

import { DEFAULT_SETTINGS, type MattersSettings } from '../settings';
import { normaliseFlags } from '../model/workflow';

export const CURRENT_SCHEMA = 1;

type Data = Record<string, unknown>;

/** Steps from version n to n + 1, indexed by n. Every change to settings or properties adds one. */
const STEPS: Record<number, (data: Data) => Data> = {};

const isObject = (v: unknown): v is Data => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Items with a string id and label; null when none are left. */
function validItems<T>(items: unknown): T[] | null {
	if (!Array.isArray(items)) return null;
	const valid = items.filter((i): i is T => isObject(i) && typeof i.id === 'string' && i.id !== '' && typeof i.label === 'string');
	return valid.length ? valid : null;
}

/** Turns whatever loadData returned into valid settings. Data from a newer schema is kept as is. */
export function migrateSettings(saved: unknown): MattersSettings {
	const defaults = structuredClone(DEFAULT_SETTINGS);
	if (!isObject(saved)) return defaults;

	let data: Data = structuredClone(saved);
	let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : CURRENT_SCHEMA;
	while (version < CURRENT_SCHEMA) {
		const step = STEPS[version];
		if (step) data = step(data);
		version++;
	}

	const settings: MattersSettings = {
		...defaults,
		...data,
		schemaVersion: Math.max(version, CURRENT_SCHEMA),
		folders: { ...defaults.folders, ...(isObject(data.folders) ? data.folders : {}) },
	};
	settings.statuses = validItems(settings.statuses) ?? defaults.statuses;
	settings.types = validItems(settings.types) ?? defaults.types;

	return { ...settings, ...normaliseFlags(settings.statuses, settings.types) };
}
