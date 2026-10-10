// Property test: whatever other properties a note has (scalars, lists, maps, quoting, comments, blank lines,
// anchors), and however its mtm- properties are written, an edit of mtm- keys leaves every other line byte for byte:
// with the mtm- entries' lines taken out, the note before and after are exactly equal. New keys land right after the
// last mtm- entry, and the result reads as asked.

import { describe, expect, it } from 'vitest';
import { readFrontmatter } from '../../src/files/frontmatter';
import { editFrontmatter, obsidianYaml } from '../../src/files/frontmatterEdit';

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
	(k) => `"${k}": quoted key\n`,
	(k) => `${k}: "[[Link|alias]]"\n`,
];
const BETWEEN = ['', '\n', '# a comment line\n', '\n# a comment after a blank line\n', '#no space comment\n'];

/** mtm- properties in every form a hand or a tool might write them. */
const MTM_FORMS: ((k: string, r: Rand) => string)[] = [
	(k, r) => `${k}: ${pick(r, ['action', 'next', '2026-10-15', '2026-10-15T10:00', '1', '3', 'true', 'two words'])}\n`,
	(k) => `${k}: "[[Kitchen renovation]]"\n`,
	(k) => `${k}: 'single'\n`,
	(k) => `${k}: next   # a comment after an mtm- value\n`,
	(k) => `"${k}": quoted key\n`,
	(k) => `'${k}': single-quoted key\n`,
	(k) => `${k}:\n  - "[[A]]"\n  - "[[B]]"\n`,
	(k) => `${k}:\n- compact\n- list\n`,
	(k) => `${k}: [flow, "list"]\n`,
	(k) => `${k}: |\n  Block text\n  in an mtm- value\n`,
	(k) => `${k}:\n`,
];

/** Values the edits write. */
const MTM_VALUES: unknown[] = ['action', 'next', '[[Kitchen renovation]]', '2026-10-15', '2026-10-15T10:00', 1, 3, true, ['[[A]]', '[[B]]'], '10', 'yes', 'two words', ''];

const MTM_START = /^(["']?)mtm-[\w-]*\1[ \t]*:/;

/** The note's lines without the mtm- entries (an entry's key line and the lines that continue its value). */
function withoutMtm(text: string): { rest: string[]; entries: { key: string; at: number; restBefore: number }[] } {
	const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	const rest: string[] = [];
	const entries: { key: string; at: number; restBefore: number }[] = [];
	let inEntry = false;
	lines.forEach((line, i) => {
		if (MTM_START.test(line)) {
			inEntry = true;
			entries.push({ key: (/mtm-[\w-]*/.exec(line) ?? [''])[0], at: i, restBefore: rest.length });
			return;
		}
		if (inEntry && (/^[ \t]+\S/.test(line) || /^-(?:[ \t]|\r?\n|$)/.test(line))) return;
		inEntry = false;
		rest.push(line);
	});
	return { rest, entries };
}

function generate(r: Rand): { yaml: string; mtmKeys: string[] } {
	const parts: string[] = [];
	const mtmKeys: string[] = [];
	let anchor = false;
	let foreign = 0;
	const count = 2 + Math.floor(r() * 9);
	for (let i = 0; i < count; i++) {
		parts.push(pick(r, BETWEEN));
		if (r() < 0.45) {
			const key = `mtm-k${i}`;
			parts.push(pick(r, MTM_FORMS)(key, r));
			mtmKeys.push(key);
		} else {
			const key = `other${i}`;
			foreign++;
			if (!anchor && r() < 0.15) {
				parts.push(`${key}: &shared [x, y]\n`);
				anchor = true;
			} else if (anchor && r() < 0.2) parts.push(`${key}: *shared\n`);
			else parts.push(pick(r, FOREIGN)(key, r));
		}
	}
	if (foreign === 0) parts.push('last: one\n');
	return { yaml: parts.join(''), mtmKeys };
}

function edits(r: Rand, keys: readonly string[]): { set: Record<string, unknown>; remove: string[]; added: string[] } {
	const set: Record<string, unknown> = {};
	const remove: string[] = [];
	for (const key of keys) {
		const x = r();
		if (x < 0.3) remove.push(key);
		else if (x < 0.7) set[key] = pick(r, MTM_VALUES);
	}
	const added: string[] = [];
	for (let n = Math.floor(r() * 3); n > 0; n--) {
		set[`mtm-new${n}`] = pick(r, MTM_VALUES);
		added.push(`mtm-new${n}`);
	}
	return { set, remove, added };
}

describe('other properties survive any mtm- edit byte for byte', () => {
	for (let seed = 1; seed <= 500; seed++) {
		it(`seed ${seed}`, () => {
			const r = random(seed);
			const g = generate(r);
			const eol = r() < 0.25 ? '\r\n' : '\n';
			const bom = r() < 0.15 ? '﻿' : '';
			const open = `---${pick(r, ['', '', '  ', ' \t'])}`;
			const close = `---${pick(r, ['', '', ' ', '\t '])}`;
			const note = `${bom}${open}\n${g.yaml}${close}\nBody line.\n- not a key\n`.replace(/\n/g, eol);
			const before = readFrontmatter(note).frontmatter;
			expect(before, `seed ${seed}: the generated note must read`).not.toBeNull();

			const { set, remove, added } = edits(r, g.mtmKeys);
			const out = editFrontmatter(note, set, remove);
			const context = `seed ${seed}\n--- before\n${note}\n--- after\n${out}`;

			// Everything but the mtm- entries is exactly as it was.
			const a = withoutMtm(note);
			const b = withoutMtm(out);
			expect(b.rest.join(''), context).toBe(a.rest.join(''));
			expect(out.startsWith(`${bom}${open}${eol}`), context).toBe(true);
			if (eol === '\r\n') expect(out.replace(/\r\n/g, ''), context).not.toContain('\n');

			// New keys come right after the last mtm- entry (or at the end of the block), in the order given.
			const surviving = a.entries.filter((e) => !remove.includes(e.key)).map((e) => e.key);
			const newEntries = b.entries.filter((e) => added.includes(e.key));
			expect(newEntries.map((e) => e.key), context).toEqual(added);
			const lastBefore = a.entries[a.entries.length - 1];
			const expectedRest = lastBefore ? lastBefore.restBefore : a.rest.findIndex((line, i) => i > 0 && line.startsWith('---'));
			for (const e of newEntries) expect(e.restBefore, context).toBe(expectedRest);
			const lastSurviving = Math.max(-1, ...b.entries.filter((e) => surviving.includes(e.key)).map((e) => e.at));
			for (const e of newEntries) expect(e.at, context).toBeGreaterThan(lastSurviving);

			// And it reads as asked.
			const expected: Record<string, unknown> = { ...before, ...set };
			for (const key of remove) delete expected[key];
			expect(readFrontmatter(out).frontmatter, context).toEqual(expected);
		});
	}
});

describe('a note without properties gets a block at the top', () => {
	for (let seed = 1; seed <= 50; seed++) {
		it(`seed ${seed}`, () => {
			const r = random(seed * 7919);
			const bom = r() < 0.3 ? '﻿' : '';
			const body = pick(r, ['Body line.\n', '\n---\nnot a block: after a blank line\n---\n', 'Text\n\n- [ ] a task\n', '']);
			const { set } = edits(r, []);
			set['mtm-kind'] = 'action';
			const out = editFrontmatter(bom + body, set);
			expect(out).toBe(`${bom}---\n${obsidianYaml(set)}---\n${body}`);
			expect(readFrontmatter(out).frontmatter).toEqual(set);
		});
	}
});
