// Which lines of a file a write changed, for reports and dry runs. Pure.

/** One changed line: replaced (both texts), added (`before` null) or removed (`after` null). */
export interface LineChange {
	/** 1-based, in the file after the write; for a removed line, the line that now stands where it was. */
	line: number;
	before: string | null;
	after: string | null;
}

const LINE_BREAK = /\r\n|\r|\n/;

/** The lines of a text; a final line break doesn't start another line. */
function linesOf(text: string): string[] {
	if (text === '') return [];
	const lines = text.split(LINE_BREAK);
	if (lines[lines.length - 1] === '') lines.pop();
	return lines;
}

/** Above this many cells the middle of a change is reported as replaced whole, without a line-by-line match. */
const MAX_CELLS = 4_000_000;

/** The lines that differ between two texts, in order (line endings alone don't count). */
export function changedLines(before: string, after: string): LineChange[] {
	const a = linesOf(before);
	const b = linesOf(after);
	let head = 0;
	while (head < a.length && head < b.length && a[head] === b[head]) head++;
	let tail = 0;
	while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
	const midA = a.slice(head, a.length - tail);
	const midB = b.slice(head, b.length - tail);
	if (midA.length === 0 && midB.length === 0) return [];

	// Matched lines of the middle (longest common subsequence), as pairs of indexes.
	const matches: [number, number][] = [];
	if (midA.length * midB.length <= MAX_CELLS) {
		const n = midA.length;
		const m = midB.length;
		const table = new Uint32Array((n + 1) * (m + 1));
		const at = (i: number, j: number) => table[i * (m + 1) + j] ?? 0;
		for (let i = n - 1; i >= 0; i--) {
			for (let j = m - 1; j >= 0; j--) {
				table[i * (m + 1) + j] = midA[i] === midB[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
			}
		}
		let i = 0;
		let j = 0;
		while (i < n && j < m) {
			if (midA[i] === midB[j]) {
				matches.push([i, j]);
				i++;
				j++;
			} else if (at(i + 1, j) >= at(i, j + 1)) i++;
			else j++;
		}
	}
	matches.push([midA.length, midB.length]);

	// Between matches: removed and added lines, paired up as replacements.
	const out: LineChange[] = [];
	let i = 0;
	let j = 0;
	for (const [mi, mj] of matches) {
		const removed = midA.slice(i, mi);
		const added = midB.slice(j, mj);
		const pairs = Math.max(removed.length, added.length);
		for (let k = 0; k < pairs; k++) {
			const line = head + j + Math.min(k, added.length) + 1;
			out.push({ line, before: removed[k] ?? null, after: added[k] ?? null });
		}
		i = mi + 1;
		j = mj + 1;
	}
	return out;
}
