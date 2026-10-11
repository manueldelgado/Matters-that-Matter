// The write cases: every operation on the fixture vault, applied with the files layer. The plans are committed
// (tests/fixtures/expected/plans) for an Obsidian console script to apply to a copy of the fixture; Obsidian's
// results (tests/fixtures/expected/writes/<case>/) must equal the files layer's byte for byte, apart from the
// differences listed in expected/ACCEPTED.md.
//
// Regenerate the plans after changing a case or the operations:
//   MTM_WRITE_PLANS=1 npx vitest run tests/files/writeCases.test.ts

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFrontmatter, stripBom } from '../../src/files/frontmatter';
import { contentsAfter, WriteError } from '../../src/files/write';
import { acceptedWrites, CONFIG_DIR, fixtureManifest, loadCases, MANIFEST, PLANS, planText, runCase, WRITES, type CaseRun, type WriteCase } from './writeCases';

const cases = loadCases();
const runs = new Map<string, CaseRun>(cases.map((c) => [c.name, runCase(c)]));
const run = (name: string): CaseRun => {
	const r = runs.get(name);
	if (!r) throw new Error(`No case ${name}`);
	return r;
};
const file = (name: string, path: string): string => {
	const text = run(name).written.get(path);
	if (text === undefined) throw new Error(`${name} wrote no ${path}`);
	return text;
};
const fixture = (name: string, path: string) => run(name).reader.read(path) ?? '';

describe('the write cases', () => {
	it('are at least 25, named uniquely, as plain file names', () => {
		expect(cases.length).toBeGreaterThanOrEqual(25);
		expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
		for (const c of cases) expect(c.name).toMatch(/^[a-z0-9-]+$/);
	});

	it.each(cases.map((c) => [c.name, c] as [string, WriteCase]))('%s plans a change and writes it', (name) => {
		const r = run(name);
		expect(r.outcome.files.length).toBeGreaterThan(0);
		for (const f of r.outcome.files) expect(f.changes.length + (f.path !== f.from ? 1 : 0)).toBeGreaterThan(0);
	});
});

describe('what the files layer writes', () => {
	it('writes a new Action as Obsidian does: the block in key order, a final line break', () => {
		expect(file('add-fields', 'MTM/Actions/Call Charlie about the tiles.md')).toBe(
			[
				'---',
				'mtm-kind: action',
				'mtm-type: call',
				'mtm-status: next',
				'mtm-matter: "[[Kitchen renovation]]"',
				'mtm-start: 2026-10-14',
				'mtm-due: 2026-10-16T10:00',
				'mtm-priority: 1',
				'---',
				'',
			].join('\n'),
		);
	});

	it('writes the body of a new Action: details, checklist, link', () => {
		expect(file('add-with-details-checklist-link', 'MTM/Actions/Plan the tiling.md')).toBe(
			[
				'---',
				'mtm-kind: action',
				'mtm-type: write',
				'mtm-status: later',
				'mtm-matter: "[[Kitchen renovation]]"',
				'---',
				'Behind the hob first.',
				'Then the window wall.',
				'',
				'- [ ] Measure the wall',
				'- [ ] Pick the grout',
				'',
				'[[Kitchen ideas]]',
				'',
			].join('\n'),
		);
	});

	it('marks done with the completion date after the last mtm- key', () => {
		const path = 'MTM/Sample/Actions/Confirm the worktop measurements.md';
		expect(file('done', path)).toBe(fixture('done', path).replace('mtm-status: next', 'mtm-status: done').replace('mtm-sample: true\n', 'mtm-sample: true\nmtm-completed: 2026-10-09\n'));
	});

	it('reopens: the backlog status, the completion date gone', () => {
		const path = 'MTM/Sample/Actions/Buy running shoes.md';
		expect(file('reopen', path)).toBe(fixture('reopen', path).replace('mtm-status: done', 'mtm-status: later').replace('mtm-completed: 2026-09-29\n', ''));
	});

	it('keeps CRLF line endings in the properties and the body', () => {
		const text = file('update-crlf', 'MTM/Sample/Edge cases/Edge - Windows line endings.md');
		expect(text).not.toMatch(/[^\r]\n/);
		expect(text).toContain('mtm-status: doing\r\n');
		expect(text).toContain('- [x] Second step\r\n- [ ] Third step\r\n');
	});

	it('keeps a byte-order mark', () => {
		const path = 'MTM/Sample/Edge cases/More links/More - byte-order mark.md';
		const text = file('update-byte-order-mark', path);
		expect(text.startsWith('﻿---\n')).toBe(true);
		expect(text).toBe(
			`${fixture('update-byte-order-mark', path).replace('mtm-status: next', 'mtm-status: doing')}\n- [ ] Check the mark is still there\n`,
		);
	});

	it('keeps comments, quoting and every other key of unusual YAML byte for byte', () => {
		const path = 'MTM/Sample/Edge cases/Edge - unusual YAML.md';
		expect(file('update-unusual-yaml', path)).toBe(
			fixture('update-unusual-yaml', path).replace("mtm-status: 'next'", 'mtm-status: doing').replace('mtm-sample: true\n', 'mtm-sample: true\nmtm-priority: 2\n'),
		);
	});

	it('renames a note and rewrites links of every kind to it', () => {
		const r = run('rename-links-on');
		const from = 'MTM/Sample/Actions/Confirm the worktop measurements.md';
		const to = 'MTM/Sample/Actions/Measure the worktop.md';
		expect(r.removed).toEqual([from]);
		expect(r.written.get(to)).toBe(fixture('rename-links-on', from));
		const links = file('rename-links-on', 'MTM/Sample/Notes/Worktop links.md');
		expect(links).toBe(
			[
				'---',
				'related: "[[Measure the worktop]]"',
				'see:',
				'  - "[[Measure the worktop#^corner|the corner]]"',
				'  - "[[Kitchen ideas]]"',
				'source: "[confirm](Measure%20the%20worktop.md)"',
				'---',
				'Links to an Action, in every form.',
				'',
				'- Plain: [[Measure the worktop]]',
				'- With an alias: [[Measure the worktop|measure first]]',
				'- To a heading: [[Measure the worktop#Checklist]]',
				'- To a block: [[Measure the worktop#^corner]]',
				'- By path: [[Measure the worktop|Measure the worktop]]',
				'- Relative: [[Measure the worktop]]',
				'- Markdown: [confirm](Measure%20the%20worktop.md)',
				'- Markdown with the name: [Measure the worktop](Measure%20the%20worktop.md)',
				'- In angle brackets: [brackets](<Measure the worktop.md>)',
				'- In code, not a link: `[[Confirm the worktop measurements]]`',
				'',
				'![[Measure the worktop]]',
				'',
			].join('\n'),
		);
		expect(file('rename-links-on', 'MTM/Sample/Notes/Worktop links in CRLF.md')).toBe(
			'Seen from a note with Windows line endings:\r\n\r\n- [[Measure the worktop]]\r\n- [md](Measure%20the%20worktop.md)\r\n',
		);
		expect(r.outcome.links.map((l) => l.path)).toEqual(['MTM/Sample/Notes/Worktop links in CRLF.md', 'MTM/Sample/Notes/Worktop links.md']);
		expect(r.outcome.danglingLinks).toBe(0);
	});

	it('with links not updated, moves only the note and counts the links left pointing nowhere', () => {
		const r = run('rename-links-off');
		expect([...r.written.keys()]).toEqual(['MTM/Sample/Actions/Measure the worktop.md']);
		expect(r.outcome.links).toEqual([]);
		expect(r.outcome.danglingLinks).toBe(15);
	});

	it('gives links the path form when a name stops being unique', () => {
		const text = file('rename-to-a-taken-name', 'MTM/Sample/Edge cases/Links/Links in the body.md');
		expect(text).toContain('- Plain: [[MTM/Sample/Edge cases/Links/Link target]]');
		expect(text).toContain('- With an alias: [[MTM/Sample/Edge cases/Links/Link target|the target]]');
		expect(text).toContain('- Encoded: [encoded](MTM/Sample/Edge%20cases/Links/Link%20target.md)');
	});

	it('rewrites a relative Markdown link, encoded', () => {
		const text = file('rename-markdown-backlink', 'MTM/Sample/Edge cases/Links/Links in the body.md');
		expect(text).toContain('- Up a folder: [up](Edge%20-%20renamed%20status.md)');
	});
});

describe('what the files layer writes in the harder cases', () => {
	it('edits a block whose closing line has spaces after the dashes where it is, keeping the fences', () => {
		expect(file('update-fence-whitespace', 'MTM/Sample/Edge cases/Edge - fence with spaces.md')).toBe(
			'---\nmtm-kind: action\nmtm-type: write\nmtm-status: doing\nmtm-matter: "[[Kitchen renovation]]"\n--- \t\nFence lines with spaces after the dashes.\n',
		);
	});

	it('keeps the byte-order mark when only properties change', () => {
		const path = 'MTM/Sample/Edge cases/More links/More - byte-order mark.md';
		expect(file('update-byte-order-mark-properties', path)).toBe(fixture('update-byte-order-mark-properties', path).replace('mtm-status: next', 'mtm-status: doing'));
	});

	it('encodes a percent sign and spaces in Markdown links to a renamed note; parentheses and accents stay', () => {
		expect(file('rename-to-a-title-with-symbols', 'MTM/Sample/Notes/Hotel links.md')).toBe(
			[
				'- Wikilink: [[Hotel 50% (depósito) für Zoë]]',
				'- Markdown: [hotel](Hotel%2050%25%20(depósito)%20für%20Zoë.md)',
				'- Markdown with the name: [Hotel 50% (depósito) für Zoë](Hotel%2050%25%20(depósito)%20für%20Zoë.md)',
				'- In angle brackets: [brackets](<Hotel 50% (depósito) für Zoë.md>)',
				'',
			].join('\n'),
		);
	});

	it('rewrites a link whose name became unique, as Obsidian does, and the links to the renamed note', () => {
		expect(file('rename-name-becomes-unique', 'MTM/Sample/Notes/Plumber links.md')).toBe(
			[
				'- Lower case: [[Call the plumber]]',
				'- By path, to the plain note: [[MTM/Sample/Edge cases/Twins/Call the plumber]]',
				'- By path, to the Action: [[call the plumber later]]',
				'',
			].join('\n'),
		);
	});
});

describe('what the files layer refuses', () => {
	const c = cases.find((x) => x.name === 'add-fields') as WriteCase;
	const reader = run('add-fields').reader;
	const code = (plan: Parameters<typeof contentsAfter>[0]) => {
		try {
			contentsAfter(plan, reader, { configDir: CONFIG_DIR });
			return null;
		} catch (e) {
			return e instanceof WriteError ? e.code : String(e);
		}
	};
	const create = (path: string) => ({ creates: [{ path, frontmatter: [['mtm-kind', 'action'] as [string, unknown]], body: '' }], edits: [], bodies: [], renames: [] });
	const rename = (to: string) => ({ creates: [], edits: [], bodies: [], renames: [{ from: 'MTM/Sample/Actions/Book the hotel.md', to }] });

	it('new paths outside the vault, in the configuration folder, or not notes', () => {
		expect(c).toBeDefined();
		for (const path of ['/etc/x.md', '../outside.md', 'MTM/../../outside.md', '.obsidian/x.md', 'MTM/.hidden/x.md', 'MTM/x.txt', 'MTM/x', 'MTM//x.md', 'MTM\\x.md', ' /x.md']) {
			expect(code(create(path)), path).toBe('bad-path');
			expect(code(rename(path)), path).toBe('bad-path');
		}
		expect(code(create('MTM/Actions/Fine.md'))).toBeNull();
		expect(code(rename('MTM/Sample/Actions/Fine.md'))).toBeNull();
	});

	it('properties opened by a fence that is never closed', () => {
		const unclosed = 'MTM/Sample/Edge cases/Edge - frontmatter not closed.md';
		expect(reader.read(unclosed)?.startsWith('---')).toBe(true);
		expect(code({ creates: [], edits: [{ path: unclosed, set: { 'mtm-status': 'doing' }, remove: [] }], bodies: [], renames: [] })).toBe('invalid-properties');
	});

	it('keys without the mtm- prefix', () => {
		expect(code({ creates: [], edits: [{ path: 'MTM/Sample/Actions/Book the hotel.md', set: { title: 'x' }, remove: [] }], bodies: [], renames: [] })).toBe('not-mtm');
	});
});

describe('the plans for the Obsidian run', () => {
	const write = process.env.MTM_WRITE_PLANS === '1';
	const manifestText = `${JSON.stringify(fixtureManifest(), null, '\t')}\n`;

	it.runIf(write)('are written, with the manifest of the fixture', () => {
		rmSync(PLANS, { recursive: true, force: true });
		mkdirSync(PLANS, { recursive: true });
		for (const c of cases) writeFileSync(join(PLANS, `${c.name}.json`), planText(run(c.name).casePlan));
		writeFileSync(join(PLANS, MANIFEST), manifestText);
	});

	it.skipIf(write)('are up to date (otherwise: MTM_WRITE_PLANS=1 npx vitest run tests/files/writeCases.test.ts)', () => {
		const committed = existsSync(PLANS) ? readdirSync(PLANS).filter((f) => f.endsWith('.json')).sort() : [];
		expect(committed).toEqual([MANIFEST, ...cases.map((c) => `${c.name}.json`)].sort());
		for (const c of cases) expect(readFileSync(join(PLANS, `${c.name}.json`), 'utf8'), c.name).toBe(planText(run(c.name).casePlan));
		expect(readFileSync(join(PLANS, MANIFEST), 'utf8')).toBe(manifestText);
	});
});

// ——— Obsidian's results ———

/** Every file under a folder, as vault paths. */
function walk(dir: string, prefix = ''): string[] {
	return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		return entry.isDirectory() ? walk(dir, rel) : [rel];
	});
}

/** Files the Obsidian script writes beside the vault files of a case's result. */
const RESULT_FILES = new Set(['removed.json', 'unresolved.json']);

/** A case's files as Obsidian left them, and as the files layer leaves them: path → content, plus removed paths. */
function bothTrees(c: WriteCase): { obsidian: Map<string, string>; mine: Map<string, string>; obsidianRemoved: string[]; mineRemoved: string[] } {
	const dir = join(WRITES, c.name);
	const obsidian = new Map<string, string>();
	let obsidianRemoved: string[] = [];
	for (const path of walk(dir)) {
		if (path === 'removed.json') obsidianRemoved = JSON.parse(readFileSync(join(dir, path), 'utf8')) as string[];
		else if (!RESULT_FILES.has(path)) obsidian.set(path, readFileSync(join(dir, path), 'utf8'));
	}
	const r = run(c.name);
	const mine = new Map<string, string>(Object.entries(c.setup ?? {}));
	for (const [path, text] of r.written) mine.set(path, text);
	for (const path of r.removed) mine.delete(path);
	// Obsidian's removed.json lists fixture files only; a setup note moved away was never in the fixture.
	return { obsidian, mine, obsidianRemoved, mineRemoved: r.removed.filter((path) => !(path in (c.setup ?? {}))) };
}

/** What a note says: its properties as the index reads them, and its body with line endings made plain. */
function meaningOf(text: string): { properties: Record<string, unknown> | null; body: string } {
	const plain = stripBom(text).replace(/\r\n?/g, '\n');
	const lines = plain.split('\n');
	return { properties: readFrontmatter(plain).frontmatter, body: lines.slice(readFrontmatter(plain).bodyLine).join('\n') };
}

const withoutKeys = (props: Record<string, unknown> | null, keys: readonly string[]) =>
	props && Object.fromEntries(Object.entries(props).filter(([k]) => !keys.includes(k)));

const withGolden = cases.filter((c) => existsSync(join(WRITES, c.name)));
const waiting = cases.filter((c) => !existsSync(join(WRITES, c.name)));

describe('Obsidian applied the same plans', () => {
	const accepted = acceptedWrites();
	const acceptedFor = (name: string, path: string) => accepted.find((a) => a.case === name && a.path === path);

	for (const c of waiting) it.skip(`${c.name}: waiting for the Obsidian write results`, () => {});

	it.each(withGolden.map((c) => [c.name, c] as [string, WriteCase]))('%s: the same files, byte for byte', (name, c) => {
		const { obsidian, mine, obsidianRemoved, mineRemoved } = bothTrees(c);
		expect(mineRemoved, 'files moved away').toEqual([...obsidianRemoved].sort());
		const paths = [...new Set([...obsidian.keys(), ...mine.keys()])].sort();
		for (const p of paths) {
			const a = acceptedFor(name, p);
			const theirs = obsidian.get(p);
			const ours = mine.get(p);
			if (!a) {
				expect(ours ?? null, `${name}: ${p}`).toBe(theirs ?? null);
				continue;
			}
			if (a.meaning === true) continue;
			// Style only: the same properties (apart from the keys listed) and the same body.
			expect(ours, `${name}: ${p} exists in both`).toBeDefined();
			expect(theirs, `${name}: ${p} exists in both`).toBeDefined();
			const x = meaningOf(ours ?? '');
			const y = meaningOf(theirs ?? '');
			expect(withoutKeys(x.properties, a.keys ?? []), `${name}: ${p} properties`).toEqual(withoutKeys(y.properties, a.keys ?? []));
			expect(x.body, `${name}: ${p} body`).toBe(y.body);
		}
	});

	it.each(withGolden.filter((c) => existsSync(join(WRITES, c.name, 'unresolved.json'))).map((c) => [c.name, c] as [string, WriteCase]))(
		'%s: as many links point nowhere as Obsidian counts',
		(name) => {
			const u = JSON.parse(readFileSync(join(WRITES, name, 'unresolved.json'), 'utf8')) as { before: number; after: number };
			expect(run(name).outcome.danglingLinks).toBe(u.after - u.before);
		},
	);

	it('lists no accepted difference that has gone away', () => {
		const gone = accepted.filter((a) => {
			const c = cases.find((x) => x.name === a.case);
			if (!c) return true;
			if (!existsSync(join(WRITES, c.name))) return false;
			const { obsidian, mine } = bothTrees(c);
			return obsidian.get(a.path) === mine.get(a.path);
		});
		expect(gone).toEqual([]);
	});
});
