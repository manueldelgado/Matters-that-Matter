// Statuses and Action types: lookups and the flag rules
// (one backlog status, never closed; one done status, always closed; one default type).

import type { StatusCategory, StatusDef, Tone, TypeDef } from '../settings';
import { idFromLabel } from '../services/ids';

export function backlogStatus(statuses: readonly StatusDef[]): StatusDef | undefined {
	return statuses.find((s) => s.backlog);
}

export function doneStatus(statuses: readonly StatusDef[]): StatusDef | undefined {
	return statuses.find((s) => s.done);
}

export function defaultType(types: readonly TypeDef[]): TypeDef | undefined {
	return types.find((t) => t.default);
}

export type FlagProblem =
	| 'no-statuses'
	| 'backlog-count'
	| 'backlog-closed'
	| 'done-count'
	| 'done-not-closed'
	| 'no-types'
	| 'default-type-count'
	| 'duplicate-status-id'
	| 'duplicate-type-id';

/** Every broken rule; empty when the workflow is valid. */
export function checkFlags(statuses: readonly StatusDef[], types: readonly TypeDef[]): FlagProblem[] {
	const problems: FlagProblem[] = [];
	if (statuses.length === 0) problems.push('no-statuses');
	const backlog = statuses.filter((s) => s.backlog);
	if (backlog.length !== 1) problems.push('backlog-count');
	if (backlog.some((s) => s.category === 'closed')) problems.push('backlog-closed');
	const done = statuses.filter((s) => s.done);
	if (done.length !== 1) problems.push('done-count');
	if (done.some((s) => s.category !== 'closed')) problems.push('done-not-closed');
	if (types.length === 0) problems.push('no-types');
	if (types.filter((t) => t.default).length !== 1) problems.push('default-type-count');
	if (new Set(statuses.map((s) => s.id)).size !== statuses.length) problems.push('duplicate-status-id');
	if (new Set(types.map((t) => t.id)).size !== types.length) problems.push('duplicate-type-id');
	return problems;
}

/**
 * Repairs the flags of hand-edited or synced settings, keeping valid flags where they are.
 * A workflow without a closed status gets no done flag (checkFlags still reports it).
 */
export function normaliseFlags(statuses: StatusDef[], types: TypeDef[]): { statuses: StatusDef[]; types: TypeDef[] } {
	const backlog =
		statuses.find((s) => s.backlog && s.category !== 'closed') ??
		statuses.find((s) => s.category !== 'closed') ??
		statuses[0];
	const done =
		statuses.find((s) => s.done && s.category === 'closed') ??
		statuses.find((s) => s.category === 'closed' && s !== backlog);
	const def = types.find((t) => t.default) ?? types[0];

	return {
		statuses: statuses.map((s) => withFlags(s, { backlog: s === backlog, done: s === done })),
		types: types.map((t) => withFlags(t, { default: t === def })),
	};
}

/** Sets or removes boolean flags, leaving no `false` keys behind. */
function withFlags<T extends StatusDef | TypeDef>(item: T, flags: Record<string, boolean>): T {
	const copy: Record<string, unknown> = { ...item };
	for (const [key, on] of Object.entries(flags)) {
		if (on) copy[key] = true;
		else delete copy[key];
	}
	return copy as T;
}

/** Moves the backlog flag; null if the status is closed or unknown. */
export function setBacklog(statuses: readonly StatusDef[], id: string): StatusDef[] | null {
	const target = statuses.find((s) => s.id === id);
	if (!target || target.category === 'closed' || target.done) return null;
	return statuses.map((s) => withFlags(s, { backlog: s.id === id }));
}

/** Moves the done flag; null if the status is not closed or unknown. */
export function setDone(statuses: readonly StatusDef[], id: string): StatusDef[] | null {
	const target = statuses.find((s) => s.id === id);
	if (!target || target.category !== 'closed') return null;
	return statuses.map((s) => withFlags(s, { done: s.id === id }));
}

/** Changes a category; null if it would break a flag (backlog cannot close, done must stay closed). */
export function setCategory(statuses: readonly StatusDef[], id: string, category: StatusCategory): StatusDef[] | null {
	const target = statuses.find((s) => s.id === id);
	if (!target) return null;
	if (target.backlog && category === 'closed') return null;
	if (target.done && category !== 'closed') return null;
	return statuses.map((s) => (s.id === id ? { ...s, category } : s));
}

export function setDefaultType(types: readonly TypeDef[], id: string): TypeDef[] | null {
	if (!types.some((t) => t.id === id)) return null;
	return types.map((t) => withFlags(t, { default: t.id === id }));
}

/** Items holding a flag cannot be deleted. */
export function canDeleteStatus(status: StatusDef): boolean {
	return !status.backlog && !status.done;
}

export function canDeleteType(type: TypeDef): boolean {
	return !type.default;
}

export function addStatus(
	statuses: readonly StatusDef[],
	label: string,
	tone: Tone,
	category: StatusCategory,
): StatusDef[] {
	const id = idFromLabel(label, statuses.map((s) => s.id));
	return [...statuses, { id, label, tone, category }];
}

export function addType(types: readonly TypeDef[], label: string, icon: string, tone: Tone): TypeDef[] {
	const id = idFromLabel(label, types.map((t) => t.id));
	return [...types, { id, label, icon, tone }];
}

/** Moves an item to a new index (column order follows the statuses array). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
	const copy = [...items];
	const [item] = copy.splice(from, 1);
	if (item === undefined) return copy;
	copy.splice(Math.max(0, Math.min(to, copy.length)), 0, item);
	return copy;
}
