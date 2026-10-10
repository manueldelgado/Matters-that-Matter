// Workflow presets offered by the setup wizard: statuses, and the Action types each brings.

import { DEFAULT_SETTINGS, type StatusDef, type TypeDef } from '../settings';

export type PresetId = 'default' | 'simple' | 'next' | 'custom';

/** In the order setup shows them. */
export const PRESET_IDS: readonly PresetId[] = ['default', 'simple', 'next', 'custom'];

const SIMPLE: StatusDef[] = [
	{ id: 'later', label: 'Later', tone: 'ink', category: 'open', backlog: true },
	{ id: 'doing', label: 'Doing', tone: 'butter', category: 'active' },
	{ id: 'done', label: 'Done', tone: 'mint', category: 'closed', done: true },
];

/** "Get stuff done": someday kept apart from what's next. */
const NEXT: StatusDef[] = [
	{ id: 'someday', label: 'Someday', tone: 'ink', category: 'open', backlog: true },
	{ id: 'next', label: 'Next', tone: 'sky', category: 'open' },
	{ id: 'doing', label: 'Doing', tone: 'butter', category: 'active' },
	{ id: 'waiting', label: 'Waiting', tone: 'lavender', category: 'active' },
	{ id: 'done', label: 'Done', tone: 'mint', category: 'closed', done: true },
];

/** Types as contexts: where, or with what, you can act. */
const CONTEXTS: TypeDef[] = [
	{ id: 'calls', label: 'Calls', icon: 'phone', tone: 'mint' },
	{ id: 'computer', label: 'Computer', icon: 'laptop', tone: 'sky', default: true },
	{ id: 'errands', label: 'Errands', icon: 'shopping-bag', tone: 'peach' },
	{ id: 'home', label: 'Home', icon: 'house', tone: 'butter' },
	{ id: 'agendas', label: 'Agendas', icon: 'users', tone: 'lavender' },
	{ id: 'anywhere', label: 'Anywhere', icon: 'globe', tone: 'bubblegum' },
];

/** The statuses of a preset; custom starts from the default workflow. */
export function presetStatuses(id: PresetId): StatusDef[] {
	return structuredClone(id === 'simple' ? SIMPLE : id === 'next' ? NEXT : DEFAULT_SETTINGS.statuses);
}

/** The types a preset brings: contexts for "Get stuff done", the default types otherwise. */
export function presetTypes(id: PresetId): TypeDef[] {
	return structuredClone(id === 'next' ? CONTEXTS : DEFAULT_SETTINGS.types);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The preset a workflow matches (by its statuses), or custom after any edit. */
export function matchPreset(statuses: readonly StatusDef[]): PresetId {
	for (const id of PRESET_IDS) if (id !== 'custom' && same(statuses, presetStatuses(id))) return id;
	return 'custom';
}

/** Whether these are the "Get stuff done" contexts, unchanged. */
export function areContexts(types: readonly TypeDef[]): boolean {
	return same(types, CONTEXTS);
}

export interface Loss {
	id: string;
	label: string;
	count: number;
}

export interface WorkflowLosses {
	/** Actions with at least one status or type the new workflow lacks. */
	actions: number;
	statuses: Loss[];
	types: Loss[];
}

export type Workflow = { statuses: readonly StatusDef[]; types: readonly TypeDef[] };

/**
 * Statuses and types that Actions use but the chosen workflow lacks: what the notes hold, whatever the settings say
 * (after a reinstall the settings are the defaults). Labels come from the first workflow in `labels` that knows the ID,
 * else the raw ID. Nothing is rewritten; these Actions would show orphan badges.
 */
export function workflowLosses(actions: readonly { status: unknown; type: unknown }[], next: Workflow, labels: readonly Workflow[]): WorkflowLosses {
	const has = (list: readonly { id: string }[], id: string) => list.some((x) => x.id === id);
	const statuses = new Map<string, number>();
	const types = new Map<string, number>();
	let affected = 0;
	for (const a of actions) {
		const s = typeof a.status === 'string' && a.status.trim() && !has(next.statuses, a.status) ? a.status : null;
		const t = typeof a.type === 'string' && a.type.trim() && !has(next.types, a.type) ? a.type : null;
		if (s) statuses.set(s, (statuses.get(s) ?? 0) + 1);
		if (t) types.set(t, (types.get(t) ?? 0) + 1);
		if (s || t) affected++;
	}
	const listed = (counts: Map<string, number>, pick: (w: Workflow) => readonly { id: string; label: string }[]): Loss[] => {
		const order = labels.flatMap((w) => pick(w).map((x) => x.id));
		const rank = (id: string) => {
			const i = order.indexOf(id);
			return i < 0 ? Infinity : i;
		};
		const label = (id: string) => labels.map((w) => pick(w).find((x) => x.id === id)?.label).find((l) => l !== undefined) ?? id;
		return [...counts.keys()]
			.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
			.map((id) => ({ id, label: label(id), count: counts.get(id) ?? 0 }));
	};
	return { actions: affected, statuses: listed(statuses, (w) => w.statuses), types: listed(types, (w) => w.types) };
}
