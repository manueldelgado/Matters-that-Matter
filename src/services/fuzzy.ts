// Small fuzzy matcher for quick-add tokens and suggestions. Case and accents are ignored.

export const STRONG_MATCH = 0.8;

export function normalise(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

const words = (s: string) => s.split(/[\s\-_/.]+/).filter(Boolean);

function isSubsequence(query: string, target: string): boolean {
	let i = 0;
	for (const ch of target) if (ch === query[i]) i++;
	return i === query.length;
}

/** Query words are prefixes of consecutive name words, in order ("kit ren" → "Kitchen renovation"). */
function wordPrefixes(query: string[], name: string[]): boolean {
	for (let start = 0; start + query.length <= name.length; start++) {
		if (query.every((q, i) => name[start + i]?.startsWith(q))) return true;
	}
	return false;
}

/**
 * 1 exact; 0.95 the query is the name's first words; 0.9 name starts with the query; 0.8 query words start consecutive name words;
 * 0.4 the query's letters appear in order; 0 otherwise.
 */
export function matchScore(query: string, name: string): number {
	const q = normalise(query), n = normalise(name);
	if (!q || !n) return 0;
	if (q === n) return 1;
	if (n.startsWith(`${q} `)) return 0.95;
	if (n.startsWith(q)) return 0.9;
	if (wordPrefixes(words(q), words(n))) return STRONG_MATCH;
	if (isSubsequence(q.replace(/ /g, ''), n.replace(/ /g, ''))) return 0.4;
	return 0;
}

export interface Candidate {
	/** Names to match against (for types: ID and label). */
	names: readonly string[];
	/** Lower ranks win ties (people in the people folder come first). */
	rank?: number;
}

export interface Ranked<T> {
	item: T;
	score: number;
}

/** Candidates with a score above 0, best first; ties by rank, then shorter name, then name. */
export function rank<T extends Candidate>(query: string, candidates: readonly T[]): Ranked<T>[] {
	const shortest = (c: T) => Math.min(...c.names.map((n) => n.length));
	return candidates
		.map((item) => ({ item, score: Math.max(0, ...item.names.map((n) => matchScore(query, n))) }))
		.filter((r) => r.score > 0)
		.sort(
			(a, b) =>
				b.score - a.score ||
				(a.item.rank ?? 0) - (b.item.rank ?? 0) ||
				shortest(a.item) - shortest(b.item) ||
				(a.item.names[0] ?? '').localeCompare(b.item.names[0] ?? ''),
		);
}

/** The best candidate if its match is strong. */
export function bestStrong<T extends Candidate>(query: string, candidates: readonly T[]): T | null {
	const top = rank(query, candidates)[0];
	return top && top.score >= STRONG_MATCH ? top.item : null;
}
