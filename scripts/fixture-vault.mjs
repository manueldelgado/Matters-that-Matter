#!/usr/bin/env node
// Writes the fixture vault: the sample package, exactly as setup's "sample content" option writes it for a
// given day, plus edge cases (odd values the plugin must survive, and links in every form Obsidian reads),
// the plugin's settings as setup leaves them, and an app.json with the link settings.
//
//   node scripts/fixture-vault.mjs <folder> [--now 2026-10-09T12:00] [--no-edge-cases] [--no-app-json] [--replace]
//
// The folder must be missing or empty. --replace empties it first, but only when it holds nothing but an earlier
// fixture: .obsidian (with the plugin's data.json, never a workspace) and MTM. A date alone means noon.
// Same date, same bytes: the output is deterministic.
// `npm run fixture` regenerates tests/fixtures/mtm-fixture. Other scripts import writeFixtureVault().

import { build } from 'esbuild';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The day the committed fixture is written for (a Friday). */
export const FIXTURE_NOW = '2026-10-09T12:00';

/** Where the edge cases live, inside the sample folder so removing the sample removes most of them. */
export const EDGE_FOLDER = 'MTM/Sample/Edge cases';
const LINKS = `${EDGE_FOLDER}/Links`;

// ——— The plugin's pure modules, bundled on the fly so they are always the current source ———

async function loadModules() {
	const result = await build({
		stdin: {
			contents: `
				export { planSetup } from './services/setupPlan';
				export { boardBaseContent } from './services/baseFile';
				export { STRINGS } from './strings';
				export { DEFAULT_SETTINGS } from './settings';
				export { SAMPLE_SPHERES, SAMPLE_FOLDER } from './services/samplePackage';
				export { addDays, toYmd } from './model/dates';`,
			resolveDir: join(pluginDir, 'src'),
			loader: 'ts',
		},
		bundle: true,
		format: 'esm',
		platform: 'neutral',
		write: false,
		logLevel: 'error',
	});
	const code = result.outputFiles[0].text;
	return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

// ——— Frontmatter as the plugin's notes carry it ———

const plain = /^(?!(?:true|false|null|yes|no|~)$)[\w.-]+(?::[\w.-]+)*(?: [\w.-]+(?::[\w.-]+)*)*$/i;

function frontmatterText(fm, wikilink) {
	const scalar = (v) => {
		if (typeof v === 'object') return JSON.stringify(wikilink(v.linkTo));
		if (typeof v !== 'string') return String(v);
		return plain.test(v) && !/^\d+$/.test(v) ? v : JSON.stringify(v);
	};
	return Object.entries(fm)
		.map(([k, v]) => (Array.isArray(v) ? `${k}:\n${v.map((x) => `  - ${scalar(x)}`).join('\n')}` : `${k}: ${scalar(v)}`))
		.join('\n');
}

const lines = (...l) => `${l.join('\n')}\n`;

// ——— Edge cases ———

/**
 * Values the plugin must survive, as planned notes (written like the sample) and raw files (written byte for byte).
 * Each one is named after what it tests.
 */
function edgeCases(mtm, notes, now) {
	const raw = [];
	const day = (n) => mtm.addDays(mtm.toYmd(now), n);
	const at = (name) => `${EDGE_FOLDER}/${name}.md`;
	const path = (title) => notes.find((n) => n.path.endsWith(`/${title}.md`))?.path;
	const matter = { linkTo: path('Kitchen renovation') };
	const action = (title, fm, body = 'An edge case for testing.\n') =>
		notes.push({
			path: at(title),
			kind: 'action',
			frontmatter: { 'mtm-kind': 'action', 'mtm-type': 'write', 'mtm-status': 'next', 'mtm-matter': matter, ...fm, 'mtm-sample': true },
			body,
		});

	// Values the plugin reads but never rewrites on its own.
	action('Edge - unknown status', { 'mtm-status': 'someday' });
	action('Edge - unknown type', { 'mtm-type': 'email' });
	action('Edge - Matter that does not exist', { 'mtm-matter': '[[Old project]]' });
	action('Edge - Matter link to a person', { 'mtm-matter': { linkTo: path('Alice Archer') } });
	action('Edge - start after due', { 'mtm-start': day(5), 'mtm-due': day(2) });
	action('Edge - due with seconds', { 'mtm-due': `${day(4)}T17:57:00` });
	action('Edge - due with a space', { 'mtm-due': `${day(5)} 09:00` });
	action('Edge - done without a completion date', { 'mtm-status': 'done' });
	action('Edge - waiting without a date', { 'mtm-status': 'waiting', 'mtm-waiting-on': { linkTo: path('Bob Baker') }, 'mtm-people': [{ linkTo: path('Bob Baker') }] });
	action('Edge - Matter link with an alias', { 'mtm-matter': '[[Kitchen renovation|Kitchen]]' });
	action('Edge - Matter without brackets', { 'mtm-matter': 'Kitchen renovation' });
	action('Edge - people as one link', { 'mtm-people': { linkTo: path('Bob Baker') } });
	action('Edge - person outside the people folder', { 'mtm-people': [{ linkTo: at('Zoe Zimmer') }] });
	notes.push({ path: at('Zoe Zimmer'), kind: 'note', frontmatter: { 'mtm-sample': true }, body: 'A person note outside the people folder.\n' });
	notes.push({
		path: at('Edge - unknown Sphere'),
		kind: 'matter',
		frontmatter: { 'mtm-kind': 'matter', 'mtm-icon': 'circle-help', 'mtm-state': 'active', 'mtm-lane-order': 99, 'mtm-sphere': 'volunteering', 'mtm-sample': true },
		body: 'A Matter whose Sphere is not in settings.\n',
	});

	// A Matter whose name a plain note in another folder shares: links to it need the path.
	notes.push({
		path: `${LINKS}/Edge - twin.md`,
		kind: 'matter',
		frontmatter: { 'mtm-kind': 'matter', 'mtm-icon': 'copy', 'mtm-state': 'active', 'mtm-lane-order': 98, 'mtm-sample': true },
		body: 'A Matter with the same name as a plain note in another folder.\n',
	});
	raw.push({ path: `${LINKS}/Elsewhere/Edge - twin.md`, content: lines('A plain note with the same name as a Matter in another folder.') });
	action('Edge - Matter with a twin name', { 'mtm-matter': { linkTo: `${LINKS}/Edge - twin.md` } }, lines('Links from outside both folders: [[Edge - twin]] and [[casing]].'));

	// Names that differ only in case, in two folders.
	raw.push({ path: `${LINKS}/Casing.md`, content: lines('---', 'mtm-sample: true', '---', 'Capitalised; a lower-case twin lives in Elsewhere.') });
	raw.push({ path: `${LINKS}/Elsewhere/casing.md`, content: lines('Lower case; a capitalised twin lives one folder up.') });

	// The note the link cases point at: headings and block IDs.
	raw.push({
		path: `${LINKS}/Link target.md`,
		content: lines(
			'---',
			'mtm-sample: true',
			'---',
			'A note other notes link to.',
			'',
			'## First heading',
			'',
			'Some text with a block ID. ^block-one',
			'',
			'## Second heading',
			'',
			'- A list item with a block ID ^list-block',
		),
	});

	// Every form of link in a body.
	raw.push({
		path: `${LINKS}/Links in the body.md`,
		content: lines(
			'---',
			'mtm-sample: true',
			'---',
			'Every kind of link, for checking how links are read and resolved.',
			'',
			'## Wikilinks',
			'',
			'- Plain: [[Link target]]',
			'- With the extension: [[Link target.md]]',
			'- With an alias: [[Link target|the target]]',
			'- To a heading: [[Link target#First heading]]',
			'- To a heading, with an alias: [[Link target#Second heading|second]]',
			'- To a block: [[Link target#^block-one]]',
			'- To a block, with an alias: [[Link target#^list-block|the item]]',
			'- To a heading in this note: [[#Wikilinks]]',
			'- By path: [[MTM/Sample/Edge cases/Links/Link target]]',
			'- Relative: [[../Zoe Zimmer]]',
			'- Twin names: [[Edge - twin]] and [[Elsewhere/Edge - twin]]',
			'- Case: [[link target]], [[LINK TARGET]], [[casing]] and [[Casing]]',
			'- To a Matter: [[Kitchen renovation]]',
			'- To a person: [[Alice Archer]]',
			'- To a file: [[Kitchen floor plan.svg]]',
			'- To nothing: [[Nowhere to be found]]',
			'',
			'## Markdown links',
			'',
			'- Encoded: [encoded](Link%20target.md)',
			'- In angle brackets: [brackets](<Link target.md>)',
			'- With spaces: [spaces](Link target.md)',
			'- Without the extension: [no extension](Link%20target)',
			'- To a heading: [heading](Link%20target.md#First%20heading)',
			'- Up a folder: [up](../Edge%20-%20unknown%20status.md)',
			'- From this folder: [here](./Casing.md)',
			'- By path: [path](MTM/Sample/Edge%20cases/Links/Link%20target.md)',
			'- A web page: [web](https://example.com/page.md)',
			'- To nothing: [nowhere](Nowhere.md)',
			'',
			'## Embeds',
			'',
			'![[Link target]]',
			'',
			'![[Link target#First heading]]',
			'',
			'![[Kitchen floor plan.svg]]',
			'',
			'![plan](../../Notes/Kitchen%20floor%20plan.svg)',
			'',
			'![[Nowhere.png]]',
			'',
			'## In a table',
			'',
			'| Link | Why |',
			'| --- | --- |',
			'| [[Link target\\|in a table]] | an escaped pipe before the alias |',
		),
	});

	// Links that must not count: code, comments, escapes. One that does, at the end.
	raw.push({
		path: `${LINKS}/Links that do not count.md`,
		content: lines(
			'---',
			'mtm-sample: true',
			'---',
			'Inline code: `[[Link target]]` and `[code](Link%20target.md)`.',
			'',
			'```',
			'[[Link target]]',
			'```',
			'',
			'~~~markdown',
			'[[Casing]]',
			'~~~',
			'',
			'    [[Link target]] in indented code',
			'',
			'<!-- [[Link target]] in an HTML comment -->',
			'',
			'<!--',
			'[[Casing]] in a comment over several lines',
			'-->',
			'',
			'%% [[Link target]] in an Obsidian comment %%',
			'',
			'%%',
			'[[Casing]] in an Obsidian comment over several lines',
			'%%',
			'',
			'Escaped: \\[\\[Link target\\]\\]',
			'',
			'Counted: [[Zoe Zimmer]]',
		),
	});

	// Links in properties: quoted, in a list, with a heading and alias, Markdown, unquoted, inside text.
	raw.push({
		path: `${LINKS}/Links in properties.md`,
		content: lines(
			'---',
			'mtm-sample: true',
			'related: "[[Link target]]"',
			'see:',
			'  - "[[Link target#First heading|first]]"',
			'  - "[[Casing]]"',
			'  - "[[Nowhere in properties]]"',
			'source: "[target](Link%20target.md)"',
			'bare: [[Link target]]',
			'inside: "Before [[Zoe Zimmer]] and after"',
			'---',
			'Links in properties, in every form people write them.',
		),
	});

	// Relative links and twins seen from the twins' other folder.
	raw.push({
		path: `${LINKS}/Elsewhere/Relative links.md`,
		content: lines(
			'Seen from the Elsewhere folder:',
			'',
			'- [[../Link target]]',
			'- [up](../Link%20target.md)',
			'- [[Edge - twin]]',
			'- [[casing]] and [[Casing]]',
		),
	});

	// Frontmatter that is not what it seems.
	raw.push({
		path: at('Edge - invalid YAML'),
		content: lines('---', 'mtm-kind: action', 'mtm-status: [next', 'mtm-matter: "[[Kitchen renovation]]"', '---', 'Properties that do not parse.'),
	});
	raw.push({ path: at('Edge - frontmatter not closed'), content: lines('---', 'mtm-kind: action', 'mtm-type: write', '', 'The closing line is missing.') });
	raw.push({ path: at('Edge - empty frontmatter'), content: lines('---', '---', 'Nothing between the lines.') });
	raw.push({ path: at('Edge - frontmatter after a blank line'), content: lines('', '---', 'mtm-kind: action', '---', 'A blank line first, so these are not properties.') });
	raw.push({ path: at('Edge - only a kind'), content: lines('---', 'mtm-kind: action', '---') });
	raw.push({
		path: at('Edge - unusual YAML'),
		content: lines(
			'---',
			'# A comment before the properties',
			'mtm-kind: action',
			'mtm-type: call   # a comment after a value',
			"mtm-status: 'next'",
			'mtm-matter: "[[Kitchen renovation]]"',
			'aliases: [Unusual, "Odd one"]',
			'tags:',
			'- edge',
			'- yaml',
			'note: |',
			'  A block of text',
			'  over two lines.',
			'count: 007',
			'when: 2026-10-09',
			'flag: yes',
			'empty:',
			'mtm-sample: true',
			'---',
			'Properties written by hand: comments, quoting, block text and values YAML versions read differently.',
		),
	});

	// Line endings and task forms.
	raw.push({
		path: at('Edge - Windows line endings'),
		content: lines(
			'---',
			'mtm-kind: action',
			'mtm-type: write',
			'mtm-status: next',
			'mtm-matter: "[[Kitchen renovation]]"',
			'mtm-sample: true',
			'---',
			'Details in a CRLF note.',
			'',
			'- [ ] First step',
			'- [x] Second step',
		).replace(/\n/g, '\r\n'),
	});
	action(
		'Edge - checklist forms',
		{},
		lines(
			'Details before the list.',
			'',
			'- [ ] Plain task',
			'- [x] Done task',
			'- [X] Done with a capital',
			'* [ ] Star bullet',
			'+ [ ] Plus bullet',
			'1. [ ] Numbered task',
			'- [-] Custom status',
			'- [ ]Missing space',
			'- [] Not a task',
			'- Plain item',
			'\t- [ ] Nested with a tab',
			'    - [ ] Nested with spaces',
			'> - [ ] In a quote',
			'',
			'```',
			'- [ ] In a code block',
			'```',
		),
	);
	return raw;
}

// ——— Writing ———

/** A date alone means noon that day, local time, like the committed fixture. */
const withTime = (now) => (typeof now === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(now) ? `${now}T12:00` : now);

/**
 * Writes the fixture into `dir` (which should be empty, apart from .obsidian). Returns what it wrote.
 * `now` is a Date, a local date and time ('2026-10-09T12:00') or a date alone (noon that day).
 */
export async function writeFixtureVault({ dir, now = FIXTURE_NOW, edgeCases: withEdgeCases = true, appJson = true }) {
	const mtm = await loadModules();
	const date = now instanceof Date ? now : new Date(withTime(now));
	if (Number.isNaN(date.getTime())) throw new Error(`Not a date: ${now}`);

	const settings = structuredClone(mtm.DEFAULT_SETTINGS);
	const plan = mtm.planSetup(
		{
			folders: settings.folders,
			statuses: settings.statuses,
			types: settings.types,
			newMatters: '',
			adopt: [],
			sample: true,
			inboxPath: settings.inboxPath,
			boardPath: settings.boardPath,
			baseContent: mtm.boardBaseContent(mtm.STRINGS.views),
			now: date,
		},
		{ exists: (p) => existsSync(join(dir, p)), isMatter: () => false, maxLaneOrder: null },
	);
	const notes = [...plan.create];
	const raw = withEdgeCases ? edgeCases(mtm, notes, date) : [];

	// Shortest link text: the name, or the path when another note has the same name (in any case).
	const names = new Map();
	const nameOf = (p) => basename(p, '.md').toLowerCase();
	for (const p of [...notes.map((n) => n.path), ...raw.map((r) => r.path)].filter((p) => p.endsWith('.md')))
		names.set(nameOf(p), (names.get(nameOf(p)) ?? 0) + 1);
	const wikilink = (p) => `[[${names.get(nameOf(p)) > 1 ? p.replace(/\.md$/, '') : basename(p, '.md')}]]`;

	const files = [];
	const write = (path, content) => {
		const file = join(dir, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, content);
		files.push(path);
	};
	// The folders setup creates, even the ones the sample leaves empty.
	for (const folder of plan.folders) mkdirSync(join(dir, folder), { recursive: true });
	for (const n of notes)
		write(n.path, n.kind === 'board' || n.kind === 'file' ? n.body : `---\n${frontmatterText(n.frontmatter, wikilink)}\n---\n${n.body}`);
	for (const r of raw) write(r.path, r.content);

	const data = { ...settings, setupDone: true, spheres: mtm.SAMPLE_SPHERES, inboxPath: plan.inboxPath, boardPath: plan.boardPath };
	write('.obsidian/plugins/matters-that-matter/data.json', `${JSON.stringify(data, null, '\t')}\n`);
	if (appJson) write('.obsidian/app.json', `${JSON.stringify({ alwaysUpdateLinks: true, newLinkFormat: 'shortest', useMarkdownLinks: false }, null, 2)}\n`);

	const count = (kind) => notes.filter((n) => n.kind === kind).length;
	return {
		files: files.sort(),
		counts: {
			matters: count('matter') + count('inbox'),
			actions: count('action'),
			notes: count('note'),
			raw: raw.length,
			boards: count('board'),
			files: count('file'),
		},
	};
}

// ——— Command line ———

const isInside = (child, parent) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
/** What a previous run leaves at the top of the folder (and what Finder adds). */
const FIXTURE_ENTRIES = new Set(['.obsidian', 'MTM', '.DS_Store']);

/** Why `dir` must not be emptied, or null when it holds nothing but an earlier fixture. */
function refusal(dir) {
	if (dir === resolve('/') || dir === homedir()) return 'it is the root or home folder';
	if (isInside(process.cwd(), dir) || isInside(pluginDir, dir)) return 'it holds the working folder or the plugin';
	if (existsSync(join(dir, '.git'))) return 'it is a git repository';
	if (existsSync(join(dir, '.obsidian/workspace.json')) || existsSync(join(dir, '.obsidian/workspace-mobile.json')))
		return 'Obsidian has opened it as a vault';
	const other = readdirSync(dir).filter((e) => !FIXTURE_ENTRIES.has(e));
	if (other.length) return `it holds more than a fixture (${other.slice(0, 3).join(', ')})`;
	if (!existsSync(join(dir, '.obsidian/plugins/matters-that-matter/data.json'))) return 'it holds no earlier fixture';
	return null;
}

function fail(message) {
	process.stderr.write(`${message}\n`);
	process.exit(2);
}

async function main(args) {
	const value = (flag) => {
		const i = args.indexOf(flag);
		return i >= 0 ? args[i + 1] : undefined;
	};
	const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--now');
	if (positional.length !== 1) fail('Usage: node scripts/fixture-vault.mjs <folder> [--now 2026-10-09T12:00] [--no-edge-cases] [--no-app-json] [--replace]');
	const dir = resolve(positional[0]);
	if (existsSync(dir) && readdirSync(dir).length > 0) {
		if (!args.includes('--replace')) fail(`Not empty: ${dir}\nPass --replace to empty it first (only a folder holding an earlier fixture).`);
		const why = refusal(dir);
		if (why) fail(`Refusing to empty ${dir}: ${why}.`);
		rmSync(dir, { recursive: true, force: true });
	}
	mkdirSync(dir, { recursive: true });
	const now = withTime(value('--now') ?? FIXTURE_NOW);
	const result = await writeFixtureVault({ dir, now, edgeCases: !args.includes('--no-edge-cases'), appJson: !args.includes('--no-app-json') });
	const c = result.counts;
	process.stdout.write(`Fixture written for ${now}: ${dir}\n`);
	process.stdout.write(
		`${result.files.length} files: ${c.matters} Matters (with the Inbox), ${c.actions} Actions, ${c.notes} other notes, ${c.raw} edge-case files written as they are, ${c.boards} board, ${c.files} attachment, settings.\n`,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2));
