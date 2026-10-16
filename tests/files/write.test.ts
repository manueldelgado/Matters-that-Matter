import { describe, expect, it } from 'vitest';
import { readFrontmatter } from '../../src/files/frontmatter';
import { contentsAfter } from '../../src/files/write';
import type { BodyEdit } from '../../src/ops/types';

const links = { alwaysUpdateLinks: true, newLinkFormat: 'shortest', useMarkdownLinks: false } as const;

/** The note after one body edit (and a property edit with it), applied as the operations apply plans. */
function after(content: string, edit: BodyEdit): string {
	const files: Record<string, string> = { 'A.md': content };
	const reader = { list: () => Object.keys(files), read: (p: string) => files[p] ?? null };
	const plan = { creates: [], edits: [{ path: 'A.md', set: { 'mtm-priority': 2 }, remove: [] }], bodies: [{ path: 'A.md', edit }], renames: [] };
	return contentsAfter(plan, reader, { configDir: '.obsidian', links }).files[0]?.after ?? '';
}

describe('body edits on a note whose properties block ends the file without a line break', () => {
	const notes = ['---\nmtm-kind: action\nmtm-status: next\n---', '---\r\nmtm-kind: action\r\nmtm-status: next\r\n---'];
	const edits: BodyEdit[] = [
		{ kind: 'details', text: 'Hello' },
		{ kind: 'checklist', items: ['a'] },
		{ kind: 'link', line: '[[X]]' },
	];

	it('keep the properties, with the body on lines of its own', () => {
		for (const note of notes) {
			for (const edit of edits) {
				const written = after(note, edit);
				expect(readFrontmatter(written).frontmatter).toEqual({ 'mtm-kind': 'action', 'mtm-status': 'next', 'mtm-priority': 2 });
				expect(written.split(/\r?\n/)).toContain('---');
				expect(written.endsWith(note.includes('\r') ? '\r\n' : '\n')).toBe(true);
			}
		}
	});
});
