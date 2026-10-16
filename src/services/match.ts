// Matching what other tools name (a status, a type, a Sphere, a Matter, a person or an Action) against the workflow
// and the vault. Pure. One match, none, or several equally good ones (never a silent pick among equals).

import { foldName } from '../files/paths';
import { linkText } from './effective';
import { matchScore, normalise, rank, STRONG_MATCH } from './fuzzy';

export type Match<T> = { kind: 'match'; item: T } | { kind: 'none' } | { kind: 'ambiguous'; items: T[] };

const none = { kind: 'none' } as const;

function fromList<T>(items: readonly T[]): Match<T> | null {
	if (items.length === 1) return { kind: 'match', item: items[0] as T };
	if (items.length > 1) return { kind: 'ambiguous', items: [...items] };
	return null;
}

/**
 * The best strong fuzzy matches: one item, or several with the same score (and the same rank, when ranks are given),
 * in the order they were given.
 */
function strongest<T>(query: string, items: readonly T[], names: (item: T) => string[], rankOf: (item: T) => number = () => 0): Match<T> {
	const ranked = rank(
		query,
		items.map((item) => ({ item, names: names(item), rank: rankOf(item) })),
	);
	const top = ranked[0];
	if (!top || top.score < STRONG_MATCH) return none;
	const best = new Set(ranked.filter((r) => r.score === top.score && (r.item.rank ?? 0) === (top.item.rank ?? 0)).map((r) => r.item.item));
	return fromList(items.filter((i) => best.has(i))) ?? none;
}

// ——— Statuses, types and Spheres ———

/** Anything defined in settings with a stable ID and a label. */
export interface Defined {
	id: string;
	label: string;
}

/** By exact ID, then by label (case and accents ignored), then by a strong fuzzy match on labels. */
export function matchDefined<T extends Defined>(query: string, items: readonly T[]): Match<T> {
	const q = query.trim();
	if (!q) return none;
	const byId = items.find((i) => i.id === q);
	if (byId) return { kind: 'match', item: byId };
	const n = normalise(q);
	const byLabel = fromList(items.filter((i) => normalise(i.label) === n));
	if (byLabel) return byLabel;
	return strongest(q, items, (i) => [i.label]);
}

// ——— Notes: Matters, people and Actions ———

/** A note that can be named: its path, its name (the file name without `.md`) and, for people, a rank (lower first). */
export interface NamedNote {
	path: string;
	name: string;
	rank?: number;
	/** The note's `mtm-id`: naming it finds the note whatever its path or name now is. */
	id?: string | null;
}

const withoutMd = (path: string) => path.replace(/\.md$/i, '');

/** Only the notes with the lowest rank (people in the people folder before other notes). */
function lowestRank<T extends NamedNote>(notes: readonly T[]): T[] {
	const best = Math.min(...notes.map((n) => n.rank ?? 0));
	return notes.filter((n) => (n.rank ?? 0) === best);
}

export interface MatchNoteOptions {
	/**
	 * Every strong fuzzy match counts, not only the best ones: several are ambiguous. For naming an Action to change,
	 * where picking the wrong one would be worse than asking.
	 */
	anyStrong?: boolean;
	/** Only a path, a name or link text that matches exactly; no fuzzy match. */
	exact?: boolean;
}

/**
 * A note named by its `mtm-id`, by its vault path (`.md` optional), by link text as a wikilink would resolve it, or by its name
 * (fuzzy, as quick add matches). Brackets, an alias or a heading around link text are ignored. Two notes with the
 * same name and rank are ambiguous even where a wikilink would pick one; a lower rank wins ties, as in quick add.
 * `resolve` turns link text into a path.
 */
export function matchNote<T extends NamedNote>(
	query: string,
	notes: readonly T[],
	resolve?: (linktext: string) => string | null,
	options: MatchNoteOptions = {},
): Match<T> {
	const text = linkText(query);
	if (!text) return none;
	// Case and Unicode form ignored, as macOS and Windows compare file names.
	const fold = foldName;
	const lower = fold(withoutMd(text));

	// An ID names one note across renames; two notes holding one ID (a copied file) are ambiguous by it.
	const byId = fromList(notes.filter((n) => n.id && n.id.toLowerCase() === text.toLowerCase()));
	if (byId) return byId;

	const byPath = fromList(notes.filter((n) => fold(withoutMd(n.path)) === lower));
	if (byPath) return byPath;

	const named = notes.filter((n) => fold(n.name) === lower);
	const byName = fromList(named.length ? lowestRank(named) : []);
	if (byName) return byName;

	const resolved = resolve?.(text);
	const target = resolved ? notes.find((n) => n.path === resolved) : undefined;
	if (target) return { kind: 'match', item: target };

	if (options.exact) return none;
	if (options.anyStrong) {
		const strong = notes.filter((n) => matchScore(text, n.name) >= STRONG_MATCH);
		return fromList(strong.length ? lowestRank(strong) : []) ?? none;
	}
	return strongest(text, notes, (n) => [n.name], (n) => n.rank ?? 0);
}
