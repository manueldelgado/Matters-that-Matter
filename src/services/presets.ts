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
	label: string;
	count: number;
}

export interface WorkflowLosses {
	/** Actions with at least one status or type the new workflow lacks. */
	actions: number;
	statuses: Loss[];
	types: Loss[];
}

type Workflow = { statuses: readonly StatusDef[]; types: readonly TypeDef[] };

/**
 * Statuses and types that Actions use now (valid in the current workflow) but the chosen one lacks.
 * Nothing is rewritten; these Actions would show orphan badges.
 */
export function workflowLosses(actions: readonly { status: unknown; type: unknown }[], current: Workflow, next: Workflow): WorkflowLosses {
	const lost = <T extends { id: string; label: string }>(now: readonly T[], then: readonly { id: string }[]) =>
		new Map(now.filter((x) => !then.some((y) => y.id === x.id)).map((x) => [x.id, { label: x.label, count: 0 }]));
	const statuses = lost(current.statuses, next.statuses);
	const types = lost(current.types, next.types);
	let affected = 0;
	for (const a of actions) {
		const s = typeof a.status === 'string' ? statuses.get(a.status) : undefined;
		const t = typeof a.type === 'string' ? types.get(a.type) : undefined;
		if (s) s.count++;
		if (t) t.count++;
		if (s || t) affected++;
	}
	const used = (m: Map<string, Loss>) => [...m.values()].filter((l) => l.count > 0);
	return { actions: affected, statuses: used(statuses), types: used(types) };
}
