import { describe, expect, it } from 'vitest';
import { addAction } from '../../src/ops/addAction';
import {
	cap,
	DETAILS_LIMIT,
	dropControls,
	findBoard,
	inertMarkdown,
	linkAddInput,
	linkQuickAddText,
	openRequest,
	shorten,
	shortenIn,
	type LinkParams,
} from '../../src/services/linkInput';
import { vault } from '../ops/snapshot';

const s = vault();

/** What an mtm-add link writes: the new note's path, body and frontmatter, or the error that stopped it. */
function written(params: LinkParams) {
	const r = addAction(linkAddInput(params), s);
	if (!r.ok) return { error: r.error.code, path: null, body: null, fm: null, warnings: [] as string[] };
	const create = r.plan.creates[0];
	if (!create) throw new Error('nothing created');
	return { error: null, path: create.path, body: create.body, fm: Object.fromEntries(create.frontmatter), warnings: r.warnings.map((w) => w.code) };
}

/** Schemes that act without `//`, as renderers and the OS know them. */
const ACTING_SCHEMES = ['javascript', 'vbscript', 'data', 'file', 'obsidian', 'mailto', 'tel', 'blob', 'about'];
/** One at the end of a scheme, unless a letter comes right before it (a renderer reading back never stops at a letter). */
const ENDS_ACTING = new RegExp(`(?<![a-z])(?:${ACTING_SCHEMES.join('|')})$`, 'i');

/**
 * Anything in a body that a renderer or another plugin could act on, checked on its own terms (not with the code
 * under test): an unescaped `<` other than the plugin's details markers and a web address written as an autolink;
 * an unescaped backtick or dollar; an embed; three tildes in a row anywhere; a comment marker; an invisible
 * character; a scheme other than http(s) whose colon is live wherever it stands (inside web addresses too); a
 * Markdown link or definition whose destination, as a renderer reads it, isn't a web address or a note.
 */
function liveMarkup(body: string): string[] {
	const found: string[] = [];
	const text = body.replace(/^<!-- \/?mtm-details: .* -->$/gm, '');
	const escaped = (at: number) => {
		let n = 0;
		for (let i = at - 1; i >= 0 && text[i] === '\\'; i--) n++;
		return n % 2 === 1;
	};
	const unescaped = (re: RegExp) => [...text.matchAll(re)].filter((m) => !escaped(m.index ?? 0));
	if (unescaped(/<(?!https?:\/\/[^\s<>]*>)/g).length) found.push('<');
	if (unescaped(/`/g).length) found.push('`');
	if (unescaped(/\$/g).length) found.push('$');
	if (unescaped(/!\[/g).length) found.push('![');
	if (text.includes('~~~')) found.push('~~~');
	if (text.includes('%%')) found.push('%%');
	// eslint-disable-next-line no-control-regex -- the check looks for control characters
	if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0\uFFF9-\uFFFB\u{E0000}-\u{E007F}]/u.test(text)) found.push('invisible');
	for (const m of text.matchAll(/([a-z][a-z0-9+.-]*):/gi)) {
		const scheme = (m[1] ?? '').toLowerCase();
		const after = text.slice((m.index ?? 0) + m[0].length);
		if (scheme.endsWith('http') || scheme.endsWith('https')) continue;
		if (after.startsWith('//') || (ENDS_ACTING.test(scheme) && /^\S/u.test(after))) found.push(`${scheme}:`);
	}
	for (const m of text.matchAll(/\]([(:])/g)) {
		if (escaped(m.index ?? 0)) continue;
		let dest = text.slice((m.index ?? 0) + 2).replace(/^\s+/u, '').replace(/^(&lt;|<)/, '');
		dest = (dest.match(/^[^\s)>]*/u)?.[0] ?? '').replace(/\\/g, '');
		try {
			dest = decodeURIComponent(dest);
		} catch {
			// kept as written
		}
		if (!/^https?:\/\//i.test(dest) && dest.includes(':')) found.push(`]${m[1] ?? ''}${dest}`);
	}
	return found;
}

// [case, link parameters, the note's path (null when refused), its body, warnings]
const HOSTILE: [string, LinkParams, string | null, string | null, string[]][] = [
	// HTML
	['a script tag in the title', { title: '<script>alert(1)</script>' }, 'MTM/Actions/script alert(1) script.md', '', []],
	['a script tag in the details', { title: 'A', details: '<script>alert(1)</script>' }, 'MTM/Actions/A.md', '&lt;script>alert(1)&lt;/script>\n', []],
	['an image with onerror', { title: 'A', details: '<img src=x onerror=alert(1)>' }, 'MTM/Actions/A.md', '&lt;img src=x onerror=alert(1)>\n', []],
	['an HTML comment spoofing the details markers', { title: 'A', details: '<!-- mtm-details: x -->\nfake\n<!-- /mtm-details: y -->' }, 'MTM/Actions/A.md', '&lt;!-- mtm-details: x -->\nfake\n&lt;!-- /mtm-details: y -->\n', []],
	['an entity standing for a colon', { title: 'A', details: '[x](obsidian&#58;//evil)' }, 'MTM/Actions/A.md', '[x](obsidian&amp;#58;//evil)\n', []],
	// Code other plugins run
	['backticks', { title: 'A', details: 'run `rm -rf` now' }, 'MTM/Actions/A.md', 'run \\`rm -rf\\` now\n', []],
	['a fenced dataviewjs block', { title: 'A', details: '```dataviewjs\ndv.paragraph(1)\n```' }, 'MTM/Actions/A.md', '\\`\\`\\`dataviewjs\ndv.paragraph(1)\n\\`\\`\\`\n', []],
	['a dataviewjs block fenced with tildes', { title: 'A', details: '~~~dataviewjs\ndv.paragraph(1)\n~~~' }, 'MTM/Actions/A.md', '\\~\\~\\~dataviewjs\ndv.paragraph(1)\n\\~\\~\\~\n', []],
	['an inline $= query', { title: 'A', details: 'Total: `$= dv.pages().length`' }, 'MTM/Actions/A.md', 'Total: \\`\\$= dv.pages().length\\`\n', []],
	['a backslash before a backtick', { title: 'A', details: '\\`$= x\\`' }, 'MTM/Actions/A.md', '\\\\\\`\\$= x\\\\\\`\n', []],
	['a Templater tag', { title: 'A', details: '<% tp.system.prompt() %>' }, 'MTM/Actions/A.md', '&lt;% tp.system.prompt() %>\n', []],
	['maths with a link', { title: 'A', details: '$\\href{obsidian://x}{y}$' }, 'MTM/Actions/A.md', '\\$\\\\href{obsidian\\://x}{y}\\$\n', []],
	['dashes that could pass for frontmatter', { title: 'A', details: '---\nmtm-status: done\ncssclasses: x\n---' }, 'MTM/Actions/A.md', '\\---\nmtm-status: done\ncssclasses: x\n\\---\n', []],
	// Embeds
	['an embedded note', { title: 'A', details: 'See ![[Some note]]' }, 'MTM/Actions/A.md', 'See \\![[Some note]]\n', []],
	['an embedded image from the web', { title: 'A', details: '![](https://evil.example/x.png)' }, 'MTM/Actions/A.md', '\\![](https://evil.example/x.png)\n', []],
	['a wikilink in the title', { title: 'Read [[Some note]] later' }, 'MTM/Actions/Read Some note later.md', '', []],
	// The link parameter
	['a javascript: link', { title: 'A', link: 'javascript:alert(1)' }, null, null, []],
	['an obsidian: link', { title: 'A', link: 'obsidian://open?file=x' }, null, null, []],
	['a file: link', { title: 'A', link: 'file:///etc/passwd' }, null, null, []],
	['a data: link', { title: 'A', link: 'data:text/html,<b>x</b>' }, null, null, []],
	['a ../ path as the link', { title: 'A', link: '../../etc/passwd' }, null, null, []],
	['a web address as the link', { title: 'A', link: 'https://example.com/a(b)' }, 'MTM/Actions/A.md', '<https://example.com/a%28b%29>\n', []],
	['a note as the link', { title: 'A', link: 'Some note' }, 'MTM/Actions/A.md', '[[Some note]]\n', []],
	['comment markers in a web address', { title: 'A', link: 'https://x.com/%%a' }, 'MTM/Actions/A.md', '<https://x.com/%25%25a>\n', []],
	['comment markers ending a web address', { title: 'A', link: 'https://x.com/a%%' }, 'MTM/Actions/A.md', '<https://x.com/a%25%25>\n', []],
	['comment markers in the query and fragment of a web address', { title: 'A', link: 'https://x.com/?q=%%#%%' }, 'MTM/Actions/A.md', '<https://x.com/?q=%25%25#%25%25>\n', []],
	// Other schemes inside text, title and details
	['a Markdown link to obsidian: in the text', { text: 'Click [here](obsidian://open?vault=x&file=y) /call' }, 'MTM/Actions/Click here (obsidian open vault=x&file=y).md', '', []],
	['a Markdown link to javascript: in the title', { title: 'Click [here](javascript:alert(1))' }, 'MTM/Actions/Click here (javascript alert(1)).md', '', []],
	['a Markdown link to obsidian: in the details, beside a web link', { title: 'A', details: 'Click [here](obsidian://delete) or [ok](https://example.com)' }, 'MTM/Actions/A.md', 'Click \\[here\\](obsidian\\://delete) or [ok](https://example.com)\n', []],
	['a Markdown link with brackets inside', { title: 'A', details: '[a [b] c](obsidian://x)' }, 'MTM/Actions/A.md', '\\[a [b] c\\](obsidian\\://x)\n', []],
	['a link definition', { title: 'A', details: '[x]: obsidian://evil\n\nSee [x].' }, 'MTM/Actions/A.md', '\\[x\\]: obsidian\\://evil\n\nSee [x].\n', []],
	['a Markdown link whose scheme hides behind a backslash', { title: 'A', details: '[x](obsidian\\://evil)' }, 'MTM/Actions/A.md', '\\[x\\](obsidian\\\\://evil)\n', []],
	['a Markdown link to file: and data: in a checklist', { title: 'A', checklist: '[y](file:///etc/passwd)\n[z](data:text/html,x)' }, 'MTM/Actions/A.md', '- [ ] \\[y\\](file\\:///etc/passwd)\n- [ ] \\[z\\](data\\:text/html,x)\n', []],
	['bare obsidian: and web addresses in the details', { title: 'A', details: 'Open obsidian://open?file=x now; or https://example.com/a:b' }, 'MTM/Actions/A.md', 'Open obsidian\\://open?file=x now; or https://example.com/a:b\n', []],
	['bare javascript:, file: and data: in the details', { title: 'A', details: 'javascript:alert(1) and file:///etc/passwd and data:text/html,x' }, 'MTM/Actions/A.md', 'javascript\\:alert(1) and file\\:///etc/passwd and data\\:text/html,x\n', []],
	['autolinks in angle brackets', { title: 'A', details: '<obsidian://open?file=x> <https://ok.example>' }, 'MTM/Actions/A.md', '&lt;obsidian\\://open?file=x> &lt;https://ok.example>\n', []],
	['a bare obsidian: address in the text', { text: 'Visit obsidian://open?file=x' }, 'MTM/Actions/Visit obsidian open file=x.md', '', []],
	['HTML in a checklist', { title: 'A', checklist: '<b>x</b>\n[y](obsidian://z)\n' }, 'MTM/Actions/A.md', '- [ ] &lt;b>x&lt;/b>\n- [ ] \\[y\\](obsidian\\://z)\n', []],
	// Fences inside quotes, callouts and lists
	['a tilde fence in a quote', { title: 'A', details: '> ~~~dataviewjs\n> dv.x\n> ~~~' }, 'MTM/Actions/A.md', '> \\~\\~\\~dataviewjs\n> dv.x\n> \\~\\~\\~\n', []],
	['a tilde fence right after the quote marker', { title: 'A', details: '>~~~dataviewjs' }, 'MTM/Actions/A.md', '>\\~\\~\\~dataviewjs\n', []],
	['tilde fences in list items', { title: 'A', details: '- ~~~dataviewjs\n1. ~~~dataviewjs' }, 'MTM/Actions/A.md', "<!-- mtm-details: the Action's details, as edited in Matters that Matter. Keep this line. -->\n- \\~\\~\\~dataviewjs\n1. \\~\\~\\~dataviewjs\n<!-- /mtm-details: end of the details. Write details above this line. -->\n", []],
	['a long run of tildes', { title: 'A', details: '~~~~~~js' }, 'MTM/Actions/A.md', '\\~\\~\\~\\~\\~\\~js\n', []],
	// Schemes behind a backslash, next to web addresses, and in links a renderer reads loosely
	['a backslash before a bare scheme', { title: 'A', details: '\\obsidian://evil' }, 'MTM/Actions/A.md', '\\\\obsidian\\://evil\n', []],
	['a scheme after a web address and a bracket', { title: 'A', details: 'https://x/)obsidian://evil' }, 'MTM/Actions/A.md', 'https://x/)obsidian\\://evil\n', []],
	['a scheme after a web address in emphasis', { title: 'A', details: '*https://x*obsidian://evil' }, 'MTM/Actions/A.md', '*https://x*obsidian\\://evil\n', []],
	['a scheme after a web address and a pipe', { title: 'A', details: 'https://x|obsidian://evil' }, 'MTM/Actions/A.md', 'https://x|obsidian\\://evil\n', []],
	['a scheme after a web address and a quote', { title: 'A', details: 'https://x/"obsidian://evil' }, 'MTM/Actions/A.md', 'https://x/"obsidian\\://evil\n', []],
	['a Markdown link glued to a web address', { title: 'A', details: 'https://a[x](obsidian://evil)' }, 'MTM/Actions/A.md', 'https://a\\[x\\](obsidian\\://evil)\n', []],
	['a space before an obsidian: destination', { title: 'A', details: '[x]( obsidian://e)' }, 'MTM/Actions/A.md', '\\[x\\]( obsidian\\://e)\n', []],
	['a space before a javascript: destination', { title: 'A', details: '[x]( javascript:alert(1))' }, 'MTM/Actions/A.md', '\\[x\\]( javascript\\:alert(1))\n', []],
	['an ideographic space in a link definition', { title: 'A', details: '[x]:\u3000obsidian://e' }, 'MTM/Actions/A.md', '\\[x\\]:\u3000obsidian\\://e\n', []],
	['a scheme glued to a digit', { title: 'A', details: '1obsidian://x and 2javascript:alert(1)' }, 'MTM/Actions/A.md', '1obsidian\\://x and 2javascript\\:alert(1)\n', []],
	['a scheme glued to letters and digits', { title: 'A', details: 'a1javascript:x and x9data:text/html,y' }, 'MTM/Actions/A.md', 'a1javascript\\:x and x9data\\:text/html,y\n', []],
	['a scheme right after another colon', { title: 'A', details: 'x:obsidian://evil and see:javascript:y' }, 'MTM/Actions/A.md', 'x:obsidian\\://evil and see:javascript\\:y\n', []],
	['a scheme glued to a digit in a checklist', { title: 'A', checklist: '1obsidian://x' }, 'MTM/Actions/A.md', '- [ ] 1obsidian\\://x\n', []],
	['a percent-encoded scheme in a destination', { title: 'A', details: '[x](obsidian%3A%2F%2Fe)' }, 'MTM/Actions/A.md', '\\[x\\](obsidian%3A%2F%2Fe)\n', []],
	[
		'acting schemes after brackets, quotes, emphasis and an underscore',
		{ title: 'A', details: `(javascript:alert(1)) "data:text/html,x" 'vbscript:y' *file:x* _about:blank` },
		'MTM/Actions/A.md',
		`(javascript\\:alert(1)) "data\\:text/html,x" 'vbscript\\:y' *file\\:x* _about\\:blank\n`,
		[],
	],
	['acting schemes in capitals', { title: 'A', details: 'JavaScript:alert(1) DATA:x Obsidian:open' }, 'MTM/Actions/A.md', 'JavaScript\\:alert(1) DATA\\:x Obsidian\\:open\n', []],
	['an acting scheme glued to +, - or .', { title: 'A', details: 'x+javascript:y a-data:x b.file:z' }, 'MTM/Actions/A.md', 'x+javascript\\:y a-data\\:x b.file\\:z\n', []],
	['an acting scheme after a lookalike letter or a joiner', { title: 'A', details: 'аdata:x meta‍data:y' }, 'MTM/Actions/A.md', 'аdata\\:x meta‍data\\:y\n', []],
	['a zero-width space before a scheme', { title: 'A', details: 'see ​javascript:alert(1)' }, 'MTM/Actions/A.md', 'see javascript\\:alert(1)\n', []],
	['an entity standing for a scheme’s first letter', { title: 'A', details: '&#106;avascript:alert(1)' }, 'MTM/Actions/A.md', '&amp;#106;avascript:alert(1)\n', []],
	['words ending in a scheme before //', { title: 'A', details: 'metadata://x and xobsidian://y' }, 'MTM/Actions/A.md', 'metadata\\://x and xobsidian\\://y\n', []],
	['Markdown links to words ending in a scheme', { title: 'A', details: '[x](metadata:y) [z](xjavascript:alert(1))' }, 'MTM/Actions/A.md', '\\[x\\](metadata:y) \\[z\\](xjavascript:alert(1))\n', []],
	['autolinks to a scheme and to a word ending in one', { title: 'A', details: '<javascript:alert(1)> <metadata:y>' }, 'MTM/Actions/A.md', '&lt;javascript\\:alert(1)> &lt;metadata:y>\n', []],
	['a scheme at the start of a line', { title: 'A', details: 'notes\ndata:text/html,x' }, 'MTM/Actions/A.md', 'notes\ndata\\:text/html,x\n', []],
	// Invisible characters and comments
	[
		'zero-width, invisible and tag characters (joiners kept)',
		{ title: 'A', details: 'a\u200Bb\u2060c\u00ADd\u180Ee\uFFF9f\u115Fg\u3164h\uFFA0i\u{E0041}j \u{1F469}\u200D\u{1F4BB}' },
		'MTM/Actions/A.md',
		'abcdefghij \u{1F469}\u200D\u{1F4BB}\n',
		[],
	],
	['comment markers', { title: 'A', details: 'before %% hidden %% after %%%' }, 'MTM/Actions/A.md', 'before %&#37; hidden %&#37; after %&#37;%\n', []],
	// Paths, characters and lengths
	['../ in the title', { title: '../../.config/plugins/x' }, 'MTM/Actions/config plugins x.md', '', []],
	['control characters and NUL', { title: 'Call\u0007 Marco\u0000', details: 'a\u0001b\u001bc' }, 'MTM/Actions/Call Marco.md', 'abc\n', []],
	['a right-to-left override', { title: 'invoice\u202Etxt.exe', details: 'pay \u2066now\u2069\u200F' }, 'MTM/Actions/invoicetxt.exe.md', 'pay now\n', []],
	['double-encoded parameters (decoded once already)', { title: 'A %3Cb%3E', details: '%3Cscript%3E %253C' }, 'MTM/Actions/A %3Cb%3E.md', '%3Cscript%3E %253C\n', []],
	// Names that match nothing
	['a Matter that does not exist', { title: 'A', matter: 'Nowhere at all' }, 'MTM/Actions/A.md', '', ['unmatched-matter']],
	['a ../ path as the Matter', { title: 'A', matter: '../../Matters/Kitchen renovation' }, 'MTM/Actions/A.md', '', ['unmatched-matter']],
	['an unknown type', { title: 'A', type: 'fax' }, 'MTM/Actions/A.md', '', ['unmatched-type']],
	['people, one unknown', { title: 'A', people: 'Marco Rossi, Nobody' }, 'MTM/Actions/A.md', '', ['unmatched-person']],
];

describe('links: hostile input written inert', () => {
	it('has at least thirty cases', () => {
		expect(HOSTILE.length).toBeGreaterThanOrEqual(30);
	});

	it.each(HOSTILE)('%s', (_name, params, path, body, warnings) => {
		const w = written(params);
		if (path === null) {
			expect(w.error).toBe('invalid');
			return;
		}
		expect(w.error).toBeNull();
		expect(w.path).toBe(path);
		expect(w.body).toBe(body);
		expect(w.warnings).toEqual(warnings);
		expect(liveMarkup(w.body ?? '')).toEqual([]);
		// Status, type and Matter always explicit; nothing from the link reaches the frontmatter as written.
		expect(Object.keys(w.fm ?? {}).slice(0, 4)).toEqual(['mtm-kind', 'mtm-type', 'mtm-status', 'mtm-matter']);
	});

	it('the check finds what it looks for in raw input', () => {
		const raw = [
			'<b>',
			'`x`',
			'$= x',
			'![[x]]',
			'> ~~~js',
			'- \\~~~js',
			'%% x',
			'a\u200Bb',
			'obsidian://x',
			'\\obsidian://x',
			'https://x/)obsidian://x',
			'javascript:y',
			'[x](javascript:y)',
			'[x]( obsidian://y)',
			'[x]:\u3000obsidian://y',
			'[x](obsidian%3A%2F%2Fy)',
			'1obsidian://x',
			'a1javascript:x',
			'x:obsidian://y',
			'<https://x.com/%%a>',
			'DATA:y',
			'x-javascript:y',
			'x.data:y',
			'_data:y',
			'аdata:y',
			'metadata://y',
		];
		for (const r of raw) expect(liveMarkup(r), r).not.toEqual([]);
		for (const word of ['metadata:y', 'Profile:x', 'hotel:5']) expect(liveMarkup(word), word).toEqual([]);
	});

	it('leaves words that only end in a scheme name as typed', () => {
		const text = 'metadata:y, bigdata:1, Profile:x, hotel:5, METADATA:Y, roundabout:here and userdata:{a}';
		const w = written({ title: 'A', details: text, checklist: 'metadata:y\nhotel:5' });
		expect(w.body).toBe(`${text}\n\n- [ ] metadata:y\n- [ ] hotel:5\n`);
		expect(liveMarkup(w.body ?? '')).toEqual([]);
		expect(inertMarkdown('profile:x and data:y')).toBe('profile:x and data\\:y');
	});

	it('never puts anything but the Matter and the people from a link into the frontmatter', () => {
		const w = written({ title: 'A', matter: '"]]\nmtm-status: done', type: 'call\nmtm-sample: true', status: 'next' });
		expect(w.fm).toEqual({ 'mtm-kind': 'action', 'mtm-type': 'write', 'mtm-status': 'next', 'mtm-matter': '[[Inbox]]' });
	});

	it('caps details at 3,000 characters', () => {
		const w = written({ title: 'A', details: 'x'.repeat(10_000) });
		expect(w.body).toBe(`${'x'.repeat(DETAILS_LIMIT)}\n`);
	});

	it('caps the title as quick add does', () => {
		const w = written({ title: 'y'.repeat(5_000) });
		expect(w.path).toBe(`MTM/Actions/${'y'.repeat(100)}.md`);
	});

	it('keeps the words quick add reads in the text', () => {
		const w = written({ text: 'Call Marco about the worktop /call #Kitchen fri 10:00 !1' });
		expect(w.path).toBe('MTM/Actions/Call Marco about the worktop.md');
		expect(w.fm).toMatchObject({ 'mtm-type': 'call', 'mtm-matter': '[[Kitchen renovation]]', 'mtm-due': '2026-10-16T10:00', 'mtm-priority': 1 });
	});

	it('leaves web addresses, notes and ordinary text as they are', () => {
		const text = 'Ask Marco: see [the quote](https://example.com/q?a=1&b=2) and [[Some note]], ratio 3:2 at 10:00.';
		expect(inertMarkdown(text)).toBe(text);
	});
});

describe('links: parameters', () => {
	it('reads every field, people comma-separated and the checklist one item per line', () => {
		expect(
			linkAddInput({
				action: 'mtm-add',
				vault: 'vault',
				text: 'Call Marco',
				title: 'Call Marco back',
				matter: 'Kitchen',
				status: 'next',
				type: 'call',
				priority: 'high',
				start: '2026-10-12',
				due: 'fri',
				'waiting-on': 'Marco Rossi',
				people: ' Marco Rossi , Lucía Pérez ,',
				details: 'About the tiles',
				checklist: 'Measure\n\nOrder',
				link: 'https://example.com',
			}),
		).toEqual({
			text: 'Call Marco',
			title: 'Call Marco back',
			matter: 'Kitchen',
			status: 'next',
			type: 'call',
			priority: 'high',
			start: '2026-10-12',
			due: 'fri',
			waitingOn: 'Marco Rossi',
			people: ['Marco Rossi', 'Lucía Pérez'],
			details: 'About the tiles',
			checklist: ['Measure', 'Order'],
			link: 'https://example.com',
		});
	});

	it('treats a parameter without a value, or an empty one, as absent', () => {
		expect(linkAddInput({ action: 'mtm-add', title: 'true', details: '' })).toEqual({});
	});

	it('never decodes a parameter again', () => {
		expect(linkAddInput({ text: '%253C %3C' }).text).toBe('%253C %3C');
		expect(linkQuickAddText({ text: '%3Cb%3E /call' })).toBe('%3Cb%3E /call');
	});

	it('quick add text: one line, controls dropped, backticks as apostrophes', () => {
		expect(linkQuickAddText({ text: 'Call\nMarco `now`\u0000 /call' })).toBe("Call Marco 'now' /call");
		expect(linkQuickAddText({})).toBe('');
	});

	it('quick add text is shown without escapes: it only ever becomes a file name, names and dates', () => {
		expect(linkQuickAddText({ text: 'Ring tel:0123 about [x](obsidian://y) #Kitchen' })).toBe('Ring tel:0123 about [x](obsidian://y) #Kitchen');
		expect(linkQuickAddText({ text: 'z'.repeat(5_000) })).toBe('z'.repeat(1_000));
	});

	it('drops control and direction characters, keeping line breaks only where asked', () => {
		expect(dropControls('a\r\nb\u2028c\u202Ed', true)).toBe('a\nb\ncd');
		expect(dropControls('a\r\nb\tc', false)).toBe('a b c');
	});

	it('caps by characters, never splitting a pair of surrogates', () => {
		expect(cap('ab😀c', 3)).toBe('ab😀');
	});
});

describe('links: opening', () => {
	it.each([
		[{ action: 'mtm-open', file: 'Call Marco' }, { kind: 'action', ref: 'Call Marco' }],
		[{ action: 'mtm-open', matter: 'Kitchen renovation' }, { kind: 'matter', ref: 'Kitchen renovation' }],
		[{ action: 'mtm-open', board: 'Matters' }, { kind: 'board', ref: 'Matters' }],
		[{ action: 'mtm-open' }, { kind: 'board', ref: null }],
		[{ action: 'mtm-open', file: 'A', matter: 'B' }, { kind: 'action', ref: 'A' }],
		[{ action: 'mtm-open', matter: 'true' }, { kind: 'board', ref: null }],
		// Obsidian's own action parameter (the link's name) is never read as an Action.
		[{ action: 'Call Marco' }, { kind: 'action', ref: 'Call Marco' }],
	])('%o asks for %o', (params, expected) => {
		expect(openRequest(params)).toEqual(expected);
	});

	const boards = ['MTM/Boards/Matters.base', 'MTM/Boards/Work.base', 'Other/Work.base'];
	it.each([
		['Matters', { kind: 'match', path: 'MTM/Boards/Matters.base' }],
		['matters.base', { kind: 'match', path: 'MTM/Boards/Matters.base' }],
		['MTM/Boards/Work', { kind: 'match', path: 'MTM/Boards/Work.base' }],
		['/Other/Work.base', { kind: 'match', path: 'Other/Work.base' }],
		['Work', { kind: 'several', paths: ['MTM/Boards/Work.base', 'Other/Work.base'] }],
		['Nothing', { kind: 'none' }],
	])('finds the board %s', (ref, expected) => {
		expect(findBoard(ref, boards)).toEqual(expected);
	});
});

describe('links: values in notices', () => {
	it('keeps short values and cuts long ones to 80 characters with an ellipsis', () => {
		expect(shorten('Call Marco')).toBe('Call Marco');
		expect(shorten('x'.repeat(80))).toBe('x'.repeat(80));
		expect(shorten('x'.repeat(81))).toBe(`${'x'.repeat(79)}…`);
		expect(Array.from(shorten('😀'.repeat(200))).length).toBe(80);
	});

	it('shortens the value an error message quotes', () => {
		const long = `javascript:${'a'.repeat(500)}`;
		const r = addAction(linkAddInput({ title: 'A', link: long }), s);
		if (r.ok) throw new Error('expected a refusal');
		const message = shortenIn(r.error.message, r.error.value);
		expect(message).toContain(`“${shorten(long)}”`);
		expect(message.length).toBeLessThan(200);
		expect(shortenIn('No Matter matches “Kitchen”.', 'Kitchen')).toBe('No Matter matches “Kitchen”.');
	});
});
