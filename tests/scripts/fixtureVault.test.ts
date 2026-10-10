// The fixture vault in tests/fixtures/mtm-fixture is generated: it must equal a fresh run of the script,
// and it must hold every edge case the file layer is checked against.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(root, 'tests/fixtures/mtm-fixture');
const EDGE = 'MTM/Sample/Edge cases';
const LINKS = `${EDGE}/Links`;
const MORE = `${EDGE}/More links`;

/** Every file under `dir`, relative, sorted; folders and Finder's .DS_Store left out (git keeps neither). */
function filesUnder(dir: string, prefix = ''): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...filesUnder(dir, rel));
		else if (entry.name !== '.DS_Store') out.push(rel);
	}
	return out.sort();
}

const read = (path: string) => readFileSync(join(FIXTURE, path), 'utf8');

describe('fixture vault', () => {
	const fresh = mkdtempSync(join(tmpdir(), 'mtm-fixture-'));
	afterAll(() => rmSync(fresh, { recursive: true, force: true }));

	it('equals a fresh run of the script (npm run fixture regenerates it)', () => {
		execFileSync(process.execPath, [join(root, 'scripts/fixture-vault.mjs'), fresh], { cwd: root, stdio: 'pipe' });
		const committed = filesUnder(FIXTURE);
		expect(filesUnder(fresh)).toEqual(committed);
		const differing = committed.filter((f) => !readFileSync(join(fresh, f)).equals(readFileSync(join(FIXTURE, f))));
		expect(differing).toEqual([]);
	}, 30_000);

	it('holds the settings and link settings Obsidian needs', () => {
		const data = JSON.parse(read('.obsidian/plugins/matters-that-matter/data.json')) as { setupDone: boolean; spheres: { id: string }[] };
		expect(data.setupDone).toBe(true);
		expect(data.spheres.map((s) => s.id)).toEqual(['home', 'advisory', 'research', 'teaching']);
		expect(JSON.parse(read('.obsidian/app.json'))).toEqual({ alwaysUpdateLinks: true, newLinkFormat: 'shortest', useMarkdownLinks: false });
	});

	// [edge case, file, text the file must contain]
	const cases: [string, string, string][] = [
		['unknown status', `${EDGE}/Edge - unknown status.md`, 'mtm-status: someday'],
		['unknown type', `${EDGE}/Edge - unknown type.md`, 'mtm-type: email'],
		['Matter that does not exist', `${EDGE}/Edge - Matter that does not exist.md`, '[[Old project]]'],
		['Matter link to a person', `${EDGE}/Edge - Matter link to a person.md`, 'mtm-matter: "[[Alice Archer]]"'],
		['start after due', `${EDGE}/Edge - start after due.md`, 'mtm-start: 2026-10-14'],
		['due with seconds', `${EDGE}/Edge - due with seconds.md`, 'T17:57:00'],
		['due with a space', `${EDGE}/Edge - due with a space.md`, '2026-10-14 09:00'],
		['done without a completion date', `${EDGE}/Edge - done without a completion date.md`, 'mtm-status: done'],
		['waiting without a date', `${EDGE}/Edge - waiting without a date.md`, 'mtm-waiting-on:'],
		['a Matter link with an alias', `${EDGE}/Edge - Matter link with an alias.md`, 'mtm-matter: "[[Kitchen renovation|Kitchen]]"'],
		['a Matter without brackets', `${EDGE}/Edge - Matter without brackets.md`, 'mtm-matter: Kitchen renovation\n'],
		['people as one link, not a list', `${EDGE}/Edge - people as one link.md`, 'mtm-people: "[[Bob Baker]]"'],
		['unknown Sphere', `${EDGE}/Edge - unknown Sphere.md`, 'mtm-sphere: volunteering'],
		['an Action whose people live outside the people folder', `${EDGE}/Edge - person outside the people folder.md`, '[[Zoe Zimmer]]'],
		['the person outside the people folder', `${EDGE}/Zoe Zimmer.md`, 'outside the people folder'],
		['CRLF line endings', `${EDGE}/Edge - Windows line endings.md`, '---\r\nmtm-kind: action\r\n'],
		['invalid YAML', `${EDGE}/Edge - invalid YAML.md`, 'mtm-status: [next\n'],
		['frontmatter not closed', `${EDGE}/Edge - frontmatter not closed.md`, 'mtm-type: write\n\n'],
		['empty frontmatter', `${EDGE}/Edge - empty frontmatter.md`, '---\n---\n'],
		['frontmatter after a blank line', `${EDGE}/Edge - frontmatter after a blank line.md`, '\n---\nmtm-kind: action'],
		['a note with only mtm-kind: action', `${EDGE}/Edge - only a kind.md`, '---\nmtm-kind: action\n---\n'],
		['comments and unusual YAML', `${EDGE}/Edge - unusual YAML.md`, '# a comment after a value'],
		['task forms', `${EDGE}/Edge - checklist forms.md`, '\t- [ ] Nested with a tab'],
		['duplicate names in two folders (a Matter)', `${LINKS}/Edge - twin.md`, 'mtm-kind: matter'],
		['duplicate names in two folders (a plain note)', `${LINKS}/Elsewhere/Edge - twin.md`, 'same name'],
		['an Action linking a twin-named Matter by path', `${EDGE}/Edge - Matter with a twin name.md`, '"[[MTM/Sample/Edge cases/Links/Edge - twin]]"'],
		['case-only differences', `${LINKS}/Casing.md`, 'Capitalised'],
		['case-only differences (twin)', `${LINKS}/Elsewhere/casing.md`, 'Lower case'],
		['case-only differences (links)', `${LINKS}/Links in the body.md`, '[[LINK TARGET]]'],
		['headings and block IDs to link to', `${LINKS}/Link target.md`, '^block-one'],
		['aliases', `${LINKS}/Links in the body.md`, '[[Link target|the target]]'],
		['headings', `${LINKS}/Links in the body.md`, '[[Link target#First heading]]'],
		['block refs', `${LINKS}/Links in the body.md`, '[[Link target#^block-one]]'],
		['Markdown links with %20', `${LINKS}/Links in the body.md`, '](Link%20target.md)'],
		['Markdown links in angle brackets', `${LINKS}/Links in the body.md`, '](<Link target.md>)'],
		['Markdown links with bare spaces', `${LINKS}/Links in the body.md`, '[spaces](Link target.md)'],
		['relative ../ links', `${LINKS}/Links in the body.md`, '](../Edge%20-%20unknown%20status.md)'],
		['relative links from another folder', `${LINKS}/Elsewhere/Relative links.md`, '[[../Link target]]'],
		['embeds', `${LINKS}/Links in the body.md`, '![[Kitchen floor plan.svg]]'],
		['an escaped pipe in a table', `${LINKS}/Links in the body.md`, '[[Link target\\|in a table]]'],
		['links in frontmatter', `${LINKS}/Links in properties.md`, 'related: "[[Link target]]"'],
		['links in a frontmatter list', `${LINKS}/Links in properties.md`, '  - "[[Casing]]"'],
		['links inside inline code', `${LINKS}/Links that do not count.md`, '`[[Link target]]`'],
		['links inside fenced code', `${LINKS}/Links that do not count.md`, '```\n[[Link target]]\n```'],
		['links inside HTML comments', `${LINKS}/Links that do not count.md`, '<!-- [[Link target]]'],
		['links inside Obsidian comments', `${LINKS}/Links that do not count.md`, '%% [[Link target]]'],
		['twins: the shorter path has more folders and sorts later', `${MORE}/Z/Y/More - deep twin.md`, 'The shorter path'],
		['twins: the longer path', `${MORE}/Alpha/More - deep twin.md`, 'The longer path'],
		['twins of equal path length (lower case)', `${MORE}/left/More - even twin.md`, 'Same path length'],
		['twins of equal path length (capitalised)', `${MORE}/Rite/More - even twin.md`, 'Same path length'],
		['the exact vault path', `${MORE}/Sub/More - exact or near.md`, 'exact vault path'],
		["the same path under the linking note's folder", `${MORE}/Inner/MTM/Sample/Edge cases/More links/Sub/More - exact or near.md`, "linking note's folder"],
		['links to each pair of twins', `${MORE}/Inner/More - which twin.md`, '[[MTM/Sample/Edge cases/More links/Sub/More - exact or near]]'],
		['a byte-order mark before the properties', `${MORE}/More - byte-order mark.md`, '\uFEFF---\nmtm-kind: action\n'],
		['a key written twice', `${MORE}/More - repeated key.md`, 'mtm-status: next\nmtm-status: doing\n'],
		['tasks inside HTML and Obsidian comments', `${MORE}/More - tasks in comments.md`, '<!--\n- [ ] In an HTML comment\n-->\n\n%%\n- [ ] In an Obsidian comment\n%%'],
		['an escaped pipe outside a table', `${MORE}/More - odd forms.md`, '[[More - target\\|the target]]'],
		['an embed in a property', `${MORE}/More - odd forms.md`, 'cover: "![[More - target]]"'],
		['an unknown YAML tag', `${MORE}/More - odd forms.md`, 'odd: !foo bar'],
	];

	it.each(cases)('has the edge case: %s', (_name, file, text) => {
		expect(existsSync(join(FIXTURE, file))).toBe(true);
		expect(read(file)).toContain(text);
	});
});
