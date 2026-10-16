// A synthetic, in-memory vault for the operations' tests. Links resolve as a simple wikilink would: by path (with or
// without `.md`), then by file name ignoring case; link text is the file name when it is unique, else the path.

import { foldName } from '../../src/files/paths';
import { DEFAULT_SETTINGS, type MattersSettings } from '../../src/settings';
import type { Snapshot } from '../../src/ops/types';

export interface TestNote {
	frontmatter?: Record<string, unknown>;
	body?: string;
}

export type TestVault = Record<string, TestNote>;

/** Friday 9 October 2026 at noon, local time. */
export const NOW = new Date(2026, 9, 9, 12, 0);

export const SETTINGS: MattersSettings = {
	...DEFAULT_SETTINGS,
	setupDone: true,
	spheres: [
		{ id: 'home', label: 'Home', icon: 'house' },
		{ id: 'work', label: 'Work', icon: 'briefcase' },
	],
};

const name = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/i, '');

function render(note: TestNote): string {
	const fm = note.frontmatter;
	const head = fm ? `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n` : '';
	return head + (note.body ?? '');
}

export function snapshot(vault: TestVault, options: { settings?: Partial<MattersSettings>; now?: Date; files?: string[] } = {}): Snapshot {
	const settings = { ...SETTINGS, ...options.settings };
	const paths = [...Object.keys(vault), ...(options.files ?? [])];
	const folders = new Set<string>();
	for (const p of paths) {
		const parts = p.split('/');
		for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
	}
	const resolve = (link: string): string | null => {
		const target = (link.split('#')[0] ?? '').trim();
		if (!target) return null;
		const exact = paths.find((p) => p === target || p === `${target}.md`);
		if (exact) return exact;
		const lower = target.toLowerCase();
		return paths.find((p) => name(p).toLowerCase() === lower || (p.split('/').pop() ?? '').toLowerCase() === lower) ?? null;
	};
	return {
		settings,
		now: options.now ?? NOW,
		notes: Object.entries(vault).map(([path, note]) => ({ path, basename: name(path), frontmatter: note.frontmatter })),
		// As hosts do: the content of every Action note is ready; other notes' content is never asked for.
		content: (path) => (vault[path]?.frontmatter?.['mtm-kind'] === 'action' ? render(vault[path]) : null),
		links: (path) => [...(vault[path]?.body ?? '').matchAll(/(?<!!)\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1] ?? ''),
		embeds: (path) => [...(vault[path]?.body ?? '').matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1] ?? ''),
		resolve: (link) => resolve(link),
		linkText: (path) => {
			const base = name(path);
			const same = paths.filter((p) => name(p).toLowerCase() === base.toLowerCase());
			return same.length > 1 ? path.replace(/\.md$/, '') : base;
		},
		exists: (path) => {
			// As macOS and Windows compare names: case and Unicode form ignored.
			const fold = foldName;
			const folded = fold(path);
			return paths.some((p) => fold(p) === folded) || [...folders].some((f) => fold(f) === folded);
		},
	};
}

const action = (fm: Record<string, unknown>, body?: string): TestNote => ({ frontmatter: { 'mtm-kind': 'action', ...fm }, body });

/** A small vault: an Inbox, three Matters, people, a note, and Actions covering the rules. */
export const VAULT: TestVault = {
	'MTM/Matters/Inbox.md': { frontmatter: { 'mtm-kind': 'matter', 'mtm-icon': 'inbox', 'mtm-state': 'active', 'mtm-lane-order': 50 } },
	'MTM/Matters/Kitchen renovation.md': {
		frontmatter: {
			'mtm-kind': 'matter',
			'mtm-icon': 'cooking-pot',
			'mtm-state': 'active',
			'mtm-lane-order': 1,
			'mtm-sphere': 'home',
			'mtm-review-every': '2w',
			'mtm-last-reviewed': '2026-09-20',
			'mtm-outcome': 'A kitchen we can cook in',
		},
	},
	'MTM/Matters/Advisory work.md': { frontmatter: { 'mtm-kind': 'matter', 'mtm-icon': 'briefcase', 'mtm-state': 'active', 'mtm-lane-order': 2, 'mtm-sphere': 'work' } },
	'MTM/Matters/Garden.md': { frontmatter: { 'mtm-kind': 'matter', 'mtm-icon': 'flower', 'mtm-state': 'dormant', 'mtm-lane-order': 3 } },
	'MTM/People/Marco Rossi.md': {},
	'MTM/People/Lucía Pérez.md': {},
	'Notes/Some note.md': { body: 'Plain note.\n' },
	'Notes/Read later.md': {},
	'MTM/Actions/Confirm the worktop measurements.md': action(
		{ 'mtm-type': 'call', 'mtm-status': 'next', 'mtm-matter': '[[Kitchen renovation]]', 'mtm-due': '2026-10-09T10:00', 'mtm-priority': 1 },
		'Confirm the worktop measurements before ordering.\n\n- [ ] Ask for the revised quote\n- [x] Measure the wall\n\nSee [[Some note]] and [[Kitchen renovation]] with [[Marco Rossi]].\n',
	),
	'MTM/Actions/Revised quote from Marco.md': action({
		'mtm-type': 'message',
		'mtm-status': 'waiting',
		'mtm-matter': '[[Kitchen renovation]]',
		'mtm-waiting-on': '[[Marco Rossi]]',
		'mtm-people': ['[[Marco Rossi]]'],
		'mtm-waiting-since': '2026-09-23',
	}),
	'MTM/Actions/Pay the council tax.md': action({ 'mtm-type': 'buy', 'mtm-status': 'next', 'mtm-matter': '[[Inbox]]', 'mtm-due': '2026-10-08' }),
	'MTM/Actions/Call Marco about the quote.md': action({
		'mtm-type': 'call',
		'mtm-status': 'next',
		'mtm-matter': '[[Kitchen renovation]]',
		'mtm-order': 20,
		'mtm-people': ['[[Marco Rossi]]', '[[Lucía Pérez]]'],
	}),
	'MTM/Actions/Call Marco back.md': action({ 'mtm-type': 'call', 'mtm-status': 'later', 'mtm-matter': '[[Inbox]]' }),
	'MTM/Actions/Send the invoice.md': action({ 'mtm-type': 'write', 'mtm-status': 'doing', 'mtm-matter': '[[Advisory work]]', 'mtm-due': '2026-10-20' }),
	'MTM/Actions/Order the tiles.md': action({ 'mtm-type': 'buy', 'mtm-status': 'done', 'mtm-matter': '[[Kitchen renovation]]', 'mtm-completed': '2026-10-01' }),
	'MTM/Actions/Mystery.md': action({ 'mtm-type': 'fax', 'mtm-status': 'someday', 'mtm-matter': '[[Nowhere]]' }),
};

export const vault = (extra: TestVault = {}, options: Parameters<typeof snapshot>[1] = {}): Snapshot => snapshot({ ...VAULT, ...extra }, options);
