// Quick add's pills: what the dialog will set, carried from one reading of the text to the next. Pure.
//
// A pill follows its words while they are in the text. Once it counts (the caret has left it, or moved), deleting
// its words, all or some, leaves it as it is, and it is still set on add; typing into its words reads them again.
// × removes a pill. People accumulate; of every other kind, the pill read or changed last is the one set, and a
// newer one replaces an older one whose words are gone.

import type { Chip, QuickAddResult } from './quickAddParser';

export interface Pill {
	id: number;
	/** What it sets, as last read; `start` and `end` say where its words are (-1 once they are gone). */
	chip: Chip;
	/** Its words as they are in the text now. */
	words: string;
	inText: boolean;
	/** Whether it counts: kept once its words are deleted. */
	counted: boolean;
	/** When it was read or last changed: the latest of a kind is the one set. */
	seq: number;
	/** Set by the type picker: it applies, but isn't shown among the typed chips. */
	picked?: boolean;
	/** Given by where quick add was opened from: it stays for the next capture after Shift+Enter. */
	given?: boolean;
}

export interface Pills {
	/** The text the pills were read from. */
	input: string;
	list: Pill[];
	next: number;
}

export type ShownChip = Chip & { pillId: number };

/** A capture as the pills say: quick add's result with the chips to show. */
export type PilledResult = Omit<QuickAddResult, 'chips'> & { chips: ShownChip[] };

export const noPills = (input = ''): Pills => ({ input, list: [], next: 1 });

type Family = 'type' | 'matter' | 'person' | 'priority' | 'date';
const family = (c: Chip): Family => (c.kind === 'invalid-date' ? 'date' : c.kind);

/** Whether a chip sets something: a matched name, a priority, a date that is read. */
const sets = (c: Chip): boolean =>
	c.kind === 'type' ? c.id !== null : c.kind === 'matter' || c.kind === 'person' ? c.path !== null : c.kind !== 'invalid-date';

/** What a chip sets, to tell a changed reading from the same one. */
function valueOf(c: Chip): string {
	switch (c.kind) {
		case 'type':
			return `type:${c.id ?? `?${c.query}`}`;
		case 'matter':
		case 'person':
			return `${c.kind}:${c.path ?? `?${c.query}`}`;
		case 'priority':
			return `priority:${c.priority}`;
		case 'date':
			return `date:${c.startDate ?? ''}>${c.due}`;
		case 'invalid-date':
			return `invalid-date:${c.text}`;
	}
}

const away = (c: Chip): Chip => ({ ...c, start: -1, end: -1 });

/**
 * The pills after the text changed from `prev.input` to `input`, read as `chips`. `caret` is where the caret is;
 * `moved` says the caret was moved (a click, the arrows, a selection) rather than carried by typing.
 */
export function carryPills(prev: Pills, input: string, chips: readonly Chip[], caret: number, moved: boolean): Pills {
	const old = prev.input;
	// The edit: old[p, delEnd) became input[p, insEnd).
	let p = 0;
	while (p < old.length && p < input.length && old[p] === input[p]) p++;
	let tail = 0;
	while (tail < old.length - p && tail < input.length - p && old[old.length - 1 - tail] === input[input.length - 1 - tail]) tail++;
	const delEnd = old.length - tail;
	const insEnd = input.length - tail;
	const delta = input.length - old.length;
	const changed = old !== input;
	const deletionOnly = changed && insEnd === p;
	const mapStart = (i: number) => (i < p ? i : i >= delEnd ? i + delta : p);
	const mapEnd = (i: number) => (i <= p ? i : i >= delEnd ? i + delta : insEnd);
	const touched = (a: number, b: number) => changed && p <= b && delEnd >= a;
	const left = (c: Chip) => moved || caret < c.start || caret > c.end;

	let next = prev.next;
	const claimed = new Set<Chip>();
	const list: Pill[] = [];
	for (const pill of prev.list) {
		if (!pill.inText) {
			list.push(pill);
			continue;
		}
		const a = mapStart(pill.chip.start), b = mapEnd(pill.chip.end);
		const over = b > a ? chips.filter((c) => family(c) === family(pill.chip) && c.start < b && c.end > a) : [];
		const chip = over.find((c) => !claimed.has(c));
		if (!chip) {
			// Its words are gone, or now part of another pill's.
			if (pill.counted && !over.length) list.push({ ...pill, chip: away(pill.chip), words: '', inText: false });
			continue;
		}
		claimed.add(chip);
		const counted = pill.counted || left(chip);
		const edited = touched(pill.chip.start, pill.chip.end);
		if (!edited || (pill.counted && deletionOnly)) {
			// An edit elsewhere, or deleting some of its words, leaves it as it is. Its words stay the span they were.
			const start = Math.min(a, chip.start), end = Math.max(b, chip.end);
			list.push({ ...pill, chip: { ...pill.chip, start, end }, words: input.slice(start, end), counted });
			continue;
		}
		const same = valueOf(chip) === valueOf(pill.chip);
		list.push({ ...pill, chip, words: chip.text, counted, seq: same ? pill.seq : next++ });
	}
	for (const chip of chips) {
		if (claimed.has(chip)) continue;
		list.push({ id: next, chip, words: chip.text, inText: true, counted: left(chip), seq: next });
		next++;
	}
	return { input, list: replaced(list), next };
}

/** Drops the pills whose words are gone once a newer one of their kind is set (people accumulate). */
function replaced(list: readonly Pill[]): Pill[] {
	const latest = new Map<Family, number>();
	for (const pill of list) {
		const f = family(pill.chip);
		if (f !== 'person' && sets(pill.chip)) latest.set(f, Math.max(latest.get(f) ?? 0, pill.seq));
	}
	return list.filter((pill) => {
		const f = family(pill.chip);
		return pill.inText || f === 'person' || pill.seq >= (latest.get(f) ?? 0);
	});
}

/** Pills that arrive without words, such as a person or a date given by where quick add was opened from. */
export function givenPills(prev: Pills, chips: readonly Chip[]): Pills {
	let next = prev.next;
	const list = [...prev.list];
	for (const chip of chips) {
		list.push({ id: next, chip: away(chip), words: '', inText: false, counted: true, seq: next, given: true });
		next++;
	}
	return { ...prev, list: replaced(list), next };
}

/** The type picker: a type that applies from now on, until another is typed or picked. */
export function pickType(prev: Pills, id: string, label: string): Pills {
	const chip: Chip = { kind: 'type', text: `/${label}`, start: -1, end: -1, query: label, id };
	const list = prev.list.filter((pill) => !pill.picked);
	list.push({ id: prev.next, chip, words: '', inText: false, counted: true, seq: prev.next, picked: true });
	return { ...prev, list: replaced(list), next: prev.next + 1 };
}

/** A cleared capture (Shift+Enter): only the pills given by where quick add was opened from stay. */
export function clearedPills(prev: Pills): Pills {
	return { input: '', list: prev.list.filter((pill) => pill.given), next: prev.next };
}

export function removePill(prev: Pills, id: number): Pills {
	return { ...prev, list: prev.list.filter((pill) => pill.id !== id) };
}

/**
 * The capture as the pills say: the title as the text gives it; the values of the pills set (every person, once; of
 * every other kind the latest); the chips to show (each person once, the one set of every other kind, and every chip
 * that sets nothing, as a warning).
 */
export function applyPills(result: QuickAddResult, pills: Pills): PilledResult {
	const out: PilledResult = { title: result.title, chips: [], typeId: null, matterPath: null, people: [], priority: null, start: null, due: null };
	const latest = new Map<Family, Pill>();
	for (const pill of pills.list) {
		const f = family(pill.chip);
		if (f === 'person' || !sets(pill.chip)) continue;
		const current = latest.get(f);
		if (!current || pill.seq > current.seq) latest.set(f, pill);
	}
	const people = new Set<string>();
	for (const pill of pills.list) {
		const c = pill.chip;
		if (c.kind === 'person' && c.path) {
			if (people.has(c.path)) continue;
			people.add(c.path);
			out.people.push(c.path);
		} else if (sets(c) && latest.get(family(c)) !== pill) continue;
		if (c.kind === 'type' && c.id) out.typeId = c.id;
		else if (c.kind === 'matter' && c.path) out.matterPath = c.path;
		else if (c.kind === 'priority') out.priority = c.priority;
		else if (c.kind === 'date') {
			out.start = c.startDate;
			out.due = c.due;
		}
		if (!pill.picked) out.chips.push({ ...c, pillId: pill.id });
	}
	// In the order written; those without words last, in the order they came.
	const at = (c: ShownChip) => (c.start < 0 ? Number.MAX_SAFE_INTEGER : c.start);
	out.chips.sort((x, y) => at(x) - at(y));
	return out;
}
