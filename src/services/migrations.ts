// Settings loading: schema migrations, defaults for missing keys, and flag repair.

import { DEFAULT_SETTINGS, TONES, type MattersSettings, type SphereDef, type StatusCategory, type StatusDef, type TypeDef } from '../settings';
import { normaliseFlags } from '../model/workflow';

export const CURRENT_SCHEMA = 3;

type Data = Record<string, unknown>;

/** Steps from version n to n + 1, indexed by n. Every change to settings or properties adds one. */
const STEPS: Record<number, (data: Data) => Data> = {
	// 2: Spheres group Matters; none until the user adds some.
	1: (data) => ({ ...data, spheres: [] }),
	// 3: new properties mtm-waiting-since (Actions) and mtm-outcome (Matters); nothing to convert.
	2: (data) => data,
};

const isObject = (v: unknown): v is Data => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Items with a string id and label; null when none are left. */
function validItems<T>(items: unknown): T[] | null {
	if (!Array.isArray(items)) return null;
	const valid = items.filter((i): i is T => isObject(i) && typeof i.id === 'string' && i.id !== '' && typeof i.label === 'string');
	return valid.length ? valid : null;
}

/** The first item with each ID. */
function unique<T extends { id: string }>(items: readonly T[]): T[] {
	const seen = new Set<string>();
	return items.filter((i) => !seen.has(i.id) && !!seen.add(i.id));
}

const CATEGORIES: readonly StatusCategory[] = ['open', 'active', 'closed'];

/**
 * Statuses with a valid category and tone, and at least one closed status for "Mark as done".
 * Existing IDs are kept, so notes keep their status.
 */
function repairStatuses(items: readonly StatusDef[]): StatusDef[] {
	const statuses = unique(items).map((s) => ({
		...s,
		category: CATEGORIES.includes(s.category) ? s.category : 'open',
		tone: TONES.includes(s.tone) ? s.tone : 'ink',
	}));
	if (!statuses.some((s) => s.category === 'closed')) {
		const done = DEFAULT_SETTINGS.statuses.find((s) => s.done);
		if (done) statuses.push({ ...done, id: uniqueId(done.id, statuses) });
	}
	return statuses;
}

function uniqueId(base: string, items: readonly { id: string }[]): string {
	let id = base;
	for (let n = 2; items.some((i) => i.id === id); n++) id = `${base}-${n}`;
	return id;
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
	settings.statuses = repairStatuses(validItems<StatusDef>(settings.statuses) ?? defaults.statuses);
	settings.types = unique(validItems<TypeDef>(settings.types) ?? defaults.types).map((t) => ({
		...t,
		icon: typeof t.icon === 'string' && t.icon ? t.icon : 'circle-dot',
		tone: TONES.includes(t.tone) ? t.tone : 'ink',
	}));
	settings.spheres = (validItems<SphereDef>(settings.spheres) ?? []).map((sp) => ({ ...sp, icon: typeof sp.icon === 'string' && sp.icon ? sp.icon : 'circle-dot' }));

	return { ...settings, ...normaliseFlags(settings.statuses, settings.types) };
}
