// Reconnecting setup to existing notes: when settings are missing (a reinstall, a new device, a copied vault),
// read the workflow, Spheres and paths back from what the notes use. Pure; nothing here writes.

import { DEFAULT_SETTINGS, TONES, type SphereDef, type StatusCategory, type StatusDef, type Tone, type TypeDef } from '../settings';
import { idFromLabel } from './ids';
import { presetStatuses, presetTypes, type PresetId } from './presets';
import { SAMPLE_SPHERES } from './samplePackage';
import type { Folders } from './setupPlan';

export interface ScannedAction {
	path: string;
	status: unknown;
	type: unknown;
	completed: unknown;
	sample: boolean;
	/** Resolved paths of the notes it names in mtm-people and mtm-waiting-on. */
	people: string[];
}

export interface ScannedMatter {
	path: string;
	sphere: unknown;
	icon: unknown;
	sample: boolean;
}

export interface VaultScan {
	actions: ScannedAction[];
	matters: ScannedMatter[];
	/** .base files that use an MTM view. */
	boards: string[];
}

export interface FoundWorkflow {
	statuses: StatusDef[];
	types: TypeDef[];
	spheres: SphereDef[];
}

export interface Reconnect extends FoundWorkflow {
	/** The preset the notes match, statuses and types alike; null when they are someone's own. */
	preset: Exclude<PresetId, 'custom'> | null;
	/** IDs whose label was made up from the ID, per kind. */
	generated: { statuses: string[]; types: string[]; spheres: string[] };
	/** Statuses added because the notes lack one the workflow needs (a backlog, a done status). */
	added: string[];
	/** How many notes use each ID: Actions for statuses and types, Matters for Spheres. */
	counts: { statuses: Record<string, number>; types: Record<string, number>; spheres: Record<string, number> };
	folders: Folders;
	/** Notes found in each chosen folder (sample notes and the Inbox aside); 0 when nothing was found. */
	inFolders: { matters: number; actions: number; people: number };
	inboxPath: string | null;
	boardPath: string | null;
	/** Actions and Matters (the Inbox aside), sample notes included. */
	actionCount: number;
	matterCount: number;
	/** The vault already holds the sample package. */
	sample: boolean;
}

const INBOX_ICON = 'inbox';

/** Whether setup should reconnect: Actions exist, or a Matter other than an Inbox at the default path. */
export function needsReconnect(scan: VaultScan, defaultInboxPath: string): boolean {
	return scan.actions.length > 0 || scan.matters.some((m) => m.path !== defaultInboxPath);
}

/** "in-progress" → "In progress". IDs were made from labels, so this is usually the label, minus accents. */
export function labelFromId(id: string): string {
	const words = id.replace(/[-_]+/g, ' ').trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

const strings = (values: unknown[]) => values.filter((v): v is string => typeof v === 'string' && v.trim() !== '');

function countIds(values: unknown[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const v of strings(values)) counts.set(v, (counts.get(v) ?? 0) + 1);
	return counts;
}

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** The folder holding most of these paths; ties go to the shortest, then alphabetically. */
function commonestFolder(paths: readonly string[]): { folder: string; count: number } | null {
	const counts = countIds(paths.map(parentOf).filter((f) => f !== ''));
	let best: { folder: string; count: number } | null = null;
	for (const [folder, count] of counts) {
		if (!best || count > best.count || (count === best.count && (folder.length < best.folder.length || (folder.length === best.folder.length && folder < best.folder))))
			best = { folder, count };
	}
	return best;
}

// ——— Statuses ———

const PRESET_ORDER: Exclude<PresetId, 'custom'>[] = ['default', 'simple', 'next'];

/** Every preset status by ID, for known IDs in someone's own workflow. */
const KNOWN_STATUSES = new Map<string, StatusDef>(
	PRESET_ORDER.flatMap((p) => presetStatuses(p)).map((s) => [s.id, { id: s.id, label: s.label, tone: s.tone, category: s.category }]),
);
/** Their place in a workflow: backlog first, done last. */
const KNOWN_RANK: Record<string, number> = { later: 0, someday: 0, next: 1, doing: 2, waiting: 3, done: 4 };
const CATEGORY_RANK: Record<StatusCategory, number> = { open: 0, active: 1, closed: 2 };

/** The preset whose statuses hold every ID found: types that fit it first, then the fewest unused, then preset order. */
function statusPreset(ids: readonly string[], typeIds: readonly string[]): Exclude<PresetId, 'custom'> | null {
	const fits = PRESET_ORDER.map((p) => ({ p, ids: presetStatuses(p).map((s) => s.id) }))
		.filter((x) => ids.every((id) => x.ids.includes(id)))
		.map((x) => ({ p: x.p, unused: ids.length ? x.ids.length - ids.length : 0, types: typesFit(typeIds, presetTypes(x.p)) ? 0 : 1 }));
	fits.sort((a, b) => a.types - b.types || a.unused - b.unused || PRESET_ORDER.indexOf(a.p) - PRESET_ORDER.indexOf(b.p));
	return fits[0]?.p ?? null;
}

/** The preset type set (default types or the contexts) holding every type ID found. */
function typeSet(ids: readonly string[]): 'default' | 'next' | null {
	if (typesFit(ids, presetTypes('default'))) return 'default';
	if (typesFit(ids, presetTypes('next'))) return 'next';
	return null;
}

const typesFit = (ids: readonly string[], types: readonly TypeDef[]) => ids.every((id) => types.some((t) => t.id === id));

/** A tone not yet used, in palette order from `from`; the palette again when all are taken. */
function nextTone(used: Set<Tone>, from: readonly Tone[] = TONES): Tone {
	const tone = from.find((t) => !used.has(t)) ?? from[used.size % from.length] ?? 'ink';
	used.add(tone);
	return tone;
}

function ownStatuses(counts: Map<string, number>, closedIds: Set<string>): { statuses: StatusDef[]; generated: string[]; added: string[] } {
	const generated: string[] = [];
	const found: StatusDef[] = [...counts.keys()].map((id) => {
		const known = KNOWN_STATUSES.get(id);
		if (known) return { ...known };
		generated.push(id);
		return { id, label: labelFromId(id), tone: 'ink', category: closedIds.has(id) ? 'closed' : 'open' };
	});
	const rank = (s: StatusDef) => KNOWN_RANK[s.id] ?? 1.5;
	found.sort(
		(a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || rank(a) - rank(b) || (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.id.localeCompare(b.id),
	);

	const added: string[] = [];
	const taken = () => found.map((s) => s.id);
	let backlog = found.find((s) => s.category === 'open');
	if (!backlog) {
		backlog = { id: idFromLabel('Later', taken()), label: 'Later', tone: 'ink', category: 'open' };
		found.unshift(backlog);
		added.push(backlog.id);
	}
	const closed = found.filter((s) => s.category === 'closed');
	let done = closed.reduce<StatusDef | undefined>((best, s) => (!best || (counts.get(s.id) ?? 0) > (counts.get(best.id) ?? 0) ? s : best), undefined);
	if (!done) {
		done = { id: idFromLabel('Done', taken()), label: 'Done', tone: 'mint', category: 'closed' };
		found.push(done);
		added.push(done.id);
	}
	backlog.backlog = true;
	done.done = true;

	// Tones: the backlog ink and done mint, as in the presets; known IDs keep theirs; the rest take the palette in turn.
	const used = new Set<Tone>(found.filter((s) => KNOWN_STATUSES.has(s.id) && !generated.includes(s.id)).map((s) => s.tone));
	if (generated.includes(backlog.id)) backlog.tone = 'ink';
	if (generated.includes(done.id)) done.tone = 'mint';
	used.add(backlog.tone).add(done.tone);
	for (const s of found) if (generated.includes(s.id) && s !== backlog && s !== done) s.tone = nextTone(used, ['sky', 'butter', 'lavender', 'peach', 'bubblegum', 'mint', 'ink']);
	return { statuses: found, generated, added };
}

// ——— Types ———

const KNOWN_TYPES = new Map<string, TypeDef>([...presetTypes('default'), ...presetTypes('next')].map((t) => [t.id, { id: t.id, label: t.label, icon: t.icon, tone: t.tone }]));

/** Likely icons for words in a type ID ("phone-call" → phone). */
const TYPE_ICONS: Record<string, string> = {
	email: 'mail', mail: 'mail', emails: 'mail', message: 'message-circle', messages: 'message-circle', chat: 'message-circle', text: 'message-circle',
	call: 'phone', calls: 'phone', phone: 'phone', ring: 'phone',
	errand: 'shopping-bag', errands: 'shopping-bag', buy: 'shopping-bag', shop: 'shopping-cart', shopping: 'shopping-cart', groceries: 'shopping-cart',
	meet: 'users', meeting: 'users', meetings: 'users', agenda: 'users', agendas: 'users',
	write: 'pencil-line', writing: 'pencil-line', draft: 'pencil-line',
	read: 'book-open', reading: 'book-open', study: 'book-open',
	code: 'code', coding: 'code', computer: 'laptop', online: 'globe', web: 'globe',
	home: 'house', house: 'house', visit: 'map-pin', travel: 'plane', trip: 'plane',
	pay: 'credit-card', payment: 'credit-card', finance: 'wallet', money: 'wallet', bills: 'receipt',
	review: 'eye', check: 'circle-check', think: 'lightbulb', idea: 'lightbulb', plan: 'map', planning: 'map',
	design: 'palette', research: 'search', admin: 'clipboard-list', health: 'heart-pulse', exercise: 'dumbbell', fix: 'wrench', repair: 'wrench',
};

export function typeIcon(id: string): string {
	for (const word of id.split(/[-_]+/)) {
		const icon = TYPE_ICONS[word];
		if (icon) return icon;
	}
	return 'circle-dot';
}

function ownTypes(counts: Map<string, number>): { types: TypeDef[]; generated: string[] } {
	const generated: string[] = [];
	// Known types in their preset order, then the rest by use.
	const known = [...KNOWN_TYPES.keys()];
	const rank = (id: string) => (known.includes(id) ? known.indexOf(id) : Infinity);
	const ids = [...counts.keys()].sort((a, b) => rank(a) - rank(b) || (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
	const used = new Set<Tone>(ids.map((id) => KNOWN_TYPES.get(id)?.tone).filter((t): t is Tone => !!t));
	const types: TypeDef[] = ids.map((id) => {
		const known = KNOWN_TYPES.get(id);
		if (known) return { ...known };
		generated.push(id);
		return { id, label: labelFromId(id), icon: typeIcon(id), tone: nextTone(used) };
	});
	// The most used is the default.
	const top = types.reduce<TypeDef | undefined>((best, t) => (!best || (counts.get(t.id) ?? 0) > (counts.get(best.id) ?? 0) ? t : best), undefined);
	if (top) top.default = true;
	return { types, generated };
}

// ——— Spheres ———

function ownSpheres(counts: Map<string, number>): { spheres: SphereDef[]; generated: string[] } {
	const sampleRank = (id: string) => {
		const i = SAMPLE_SPHERES.findIndex((s) => s.id === id);
		return i < 0 ? Infinity : i;
	};
	const ids = [...counts.keys()].sort((a, b) => sampleRank(a) - sampleRank(b) || (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
	const generated: string[] = [];
	const spheres = ids.map((id) => {
		const sample = SAMPLE_SPHERES.find((s) => s.id === id);
		if (sample) return { ...sample };
		generated.push(id);
		return { id, label: labelFromId(id), icon: 'circle-dot' };
	});
	return { spheres, generated };
}

// ——— All together ———

export function recognise(scan: VaultScan, defaults: { folders: Folders; inboxPath: string } = DEFAULT_SETTINGS): Reconnect {
	const statusCounts = countIds(scan.actions.map((a) => a.status));
	const typeCounts = countIds(scan.actions.map((a) => a.type));
	const inbox = (() => {
		const marked = scan.matters.filter((m) => m.icon === INBOX_ICON && !m.sample);
		return marked.length === 1 ? (marked[0]?.path ?? null) : null;
	})();
	const inboxPath = inbox ?? (scan.matters.some((m) => m.path === defaults.inboxPath) ? defaults.inboxPath : null);
	const sphereCounts = countIds(scan.matters.filter((m) => m.path !== inboxPath).map((m) => m.sphere));

	const statusIds = [...statusCounts.keys()];
	const typeIds = [...typeCounts.keys()];
	const statusP = statusPreset(statusIds, typeIds);
	const typeP = typeIds.length ? typeSet(typeIds) : statusP === 'next' ? 'next' : 'default';

	const generated = { statuses: [] as string[], types: [] as string[], spheres: [] as string[] };
	let added: string[] = [];
	let statuses: StatusDef[];
	if (statusP) statuses = presetStatuses(statusP);
	else {
		const closed = new Set(strings(scan.actions.filter((a) => typeof a.completed === 'string' && a.completed.trim()).map((a) => a.status)));
		const own = ownStatuses(statusCounts, closed);
		statuses = own.statuses;
		generated.statuses = own.generated;
		added = own.added;
	}
	let types: TypeDef[];
	if (typeP) types = presetTypes(typeP);
	else {
		const own = ownTypes(typeCounts);
		types = own.types;
		generated.types = own.generated;
	}
	// Recognised: a preset's statuses with the types that preset brings.
	const preset = statusP && typeP === (statusP === 'next' ? 'next' : 'default') ? statusP : null;
	const s = ownSpheres(sphereCounts);
	generated.spheres = s.generated;

	// Folders from where the notes are; sample notes don't count, or they would point into the sample's folder.
	const own = <T extends { sample: boolean }>(list: readonly T[]) => list.filter((x) => !x.sample);
	const matters = commonestFolder(own(scan.matters).map((m) => m.path));
	const actions = commonestFolder(own(scan.actions).map((a) => a.path));
	const people = commonestFolder([...new Set(own(scan.actions).flatMap((a) => a.people))]);
	const boardPath = [...scan.boards].sort((a, b) => Number(!a.endsWith('/Matters.base') && a !== 'Matters.base') - Number(!b.endsWith('/Matters.base') && b !== 'Matters.base') || a.localeCompare(b))[0] ?? null;
	const folders: Folders = {
		matters: matters?.folder ?? ((inboxPath && parentOf(inboxPath)) || defaults.folders.matters),
		actions: actions?.folder ?? defaults.folders.actions,
		boards: (boardPath && parentOf(boardPath)) || defaults.folders.boards,
		people: people?.folder ?? defaults.folders.people,
	};

	return {
		statuses,
		types,
		spheres: s.spheres,
		preset,
		generated,
		added,
		counts: { statuses: Object.fromEntries(statusCounts), types: Object.fromEntries(typeCounts), spheres: Object.fromEntries(sphereCounts) },
		folders,
		inFolders: {
			matters: matters ? own(scan.matters).filter((m) => parentOf(m.path) === matters.folder && m.path !== inboxPath).length : 0,
			actions: actions?.count ?? 0,
			people: people?.count ?? 0,
		},
		inboxPath,
		boardPath,
		actionCount: scan.actions.length,
		matterCount: scan.matters.filter((m) => m.path !== inboxPath).length,
		sample: scan.actions.some((a) => a.sample) || scan.matters.some((m) => m.sample),
	};
}

/** Statuses or types the notes use that the workflow lost, put back from what was found (without markers), in found order. */
export function putBack<T extends { id: string }>(current: readonly T[], found: readonly T[], lost: readonly string[]): T[] {
	const back = found.filter((x) => lost.includes(x.id) && !current.some((c) => c.id === x.id));
	const strip = (x: T): T => {
		const copy: Record<string, unknown> = { ...x };
		delete copy.backlog;
		delete copy.done;
		delete copy.default;
		return copy as T;
	};
	const out = [...current];
	for (const x of back) {
		// Before the first current item that came after it in the found order; else at the end.
		const after = found.slice(found.indexOf(x) + 1).map((f) => f.id);
		const at = out.findIndex((c) => after.includes(c.id));
		out.splice(at < 0 ? out.length : at, 0, strip(x));
	}
	return out;
}
