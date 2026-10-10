// Property test: whatever other properties a note has (scalars, lists, maps, quoting, comments, blank lines,
// anchors), an edit of mtm- keys leaves every one of them byte for byte, and the result reads as asked.

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { editFrontmatter } from '../../src/files/frontmatterEdit';

/** A small seeded generator (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Rand = () => number;
const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;

/** Other properties, as people write them by hand: each a block of lines ending in a line break. */
const FOREIGN: ((k: string, r: Rand) => string)[] = [
	(k) => `${k}: plain words here\n`,
	(k) => `${k}: 'single quoted: yes'\n`,
	(k) => `${k}: "double \\"quoted\\" text"\n`,
	(k, r) => `${k}: ${pick(r, ['42', '007', '3.5', 'yes', 'no', 'null', '~', '2026-10-09', '2026-10-09T10:00', 'true'])}\n`,
	(k) => `${k}: value   # a comment after it\n`,
	(k) => `${k}:\n  - one\n  - "[[Two]]"\n`,
	(k) => `${k}:\n- compact\n- list\n`,
	(k) => `${k}:\n  - a\n  # a comment inside the list\n`,
	(k) => `${k}: [flow, "list, quoted", 3]\n`,
	(k) => `${k}:\n  nested: 1\n  deeper:\n    - x\n    - y: z\n`,
	(k) => `${k}: {a: 1, b: [2, 3]}\n`,
	(k) => `${k}: |\n  A block of text\n  over two lines.\n`,
	(k) => `${k}: >-\n  Folded text\n  on two lines\n`,
	(k) => `${k}:\n`,
	(k) => `${k}: "[[Link|alias]]"\n`,
];
const BETWEEN = ['', '\n', '# a comment line\n', '\n# a comment after a blank line\n', '#no space comment\n'];

/** mtm- properties as the plugin writes them. */
const MTM_VALUES: unknown[] = ['action', 'next', '[[Kitchen renovation]]', '2026-10-15', '2026-10-15T10:00', 1, 3, true, ['[[A]]', '[[B]]'], '10', 'yes', 'two words', ''];
const mtmText = (k: string, v: unknown) => (Array.isArray(v) ? `${k}:\n${v.map((x) => `  - "${String(x)}"`).join('\n')}\n` : `${k}: ${typeof v === 'string' && v !== '' && !/^\[|^\d+$|^yes$/.test(v) ? v : JSON.stringify(v)}\n`);

interface Generated {
	yaml: string;
	/** The other properties and the lines between properties, in order: each must survive as written. */
	kept: string[];
	mtmKeys: string[];
}

function generate(r: Rand): Generated {
	const parts: { text: string; kept: boolean; key?: string }[] = [];
	let anchor = false;
	const count = 2 + Math.floor(r() * 9);
	for (let i = 0; i < count; i++) {
		const between = pick(r, BETWEEN);
		if (between) parts.push({ text: between, kept: true });
		if (r() < 0.45) {
			const key = `mtm-k${i}`;
			parts.push({ text: mtmText(key, pick(r, MTM_VALUES)), kept: false, key });
		} else {
			const key = `other${i}`;
			let text: string;
			if (!anchor && r() < 0.15) {
				text = `${key}: &shared [x, y]\n`;
				anchor = true;
			} else if (anchor && r() < 0.2) text = `${key}: *shared\n`;
			else text = pick(r, FOREIGN)(key, r);
			parts.push({ text, kept: true });
		}
	}
	if (!parts.some((p) => p.kept && /^[a-z]/.test(p.text))) parts.push({ text: 'last: one\n', kept: true });
	return { yaml: parts.map((p) => p.text).join(''), kept: parts.filter((p) => p.kept).map((p) => p.text), mtmKeys: parts.flatMap((p) => (p.key ? [p.key] : [])) };
}

/** Whether `parts` appear in `text` in order, each as written. */
function inOrder(text: string, parts: readonly string[]): string | null {
	let at = 0;
	for (const part of parts) {
		const i = text.indexOf(part, at);
		if (i < 0) return part;
		at = i + part.length;
	}
	return null;
}

describe('other properties survive any mtm- edit byte for byte', () => {
	for (let seed = 1; seed <= 400; seed++) {
		it(`seed ${seed}`, () => {
			const r = random(seed);
			const g = generate(r);
			const crlf = r() < 0.25;
			const eol = crlf ? '\r\n' : '\n';
			const note = `---\n${g.yaml}---\nBody line.\n`.replace(/\n/g, eol);
			const before = parse(g.yaml) as Record<string, unknown>;

			const set: Record<string, unknown> = {};
			const remove: string[] = [];
			for (const key of g.mtmKeys) {
				const x = r();
				if (x < 0.3) remove.push(key);
				else if (x < 0.7) set[key] = pick(r, MTM_VALUES);
			}
			for (let n = Math.floor(r() * 3); n > 0; n--) set[`mtm-new${n}`] = pick(r, MTM_VALUES);

			const out = editFrontmatter(note, set, remove);
			const missing = inOrder(out, g.kept.map((k) => k.replace(/\n/g, eol)));
			expect(missing, `seed ${seed}: lost\n${JSON.stringify(missing)}\nin\n${out}`).toBeNull();
			expect(out.endsWith(`---${eol}Body line.${eol}`)).toBe(true);
			if (crlf) expect(out).not.toMatch(/[^\r]\n/);

			const expected: Record<string, unknown> = { ...before, ...set };
			for (const key of remove) delete expected[key];
			const block = out.slice(3 + eol.length, out.lastIndexOf(`---${eol}Body line.`));
			expect(parse(block)).toEqual(expected);
		});
	}
});
