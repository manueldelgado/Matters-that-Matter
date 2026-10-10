import { describe, expect, it } from 'vitest';
import { applyBodyEdit, applyFrontmatterEdit, PlanBuilder } from '../../src/ops/plan';
import { appendLine } from '../../src/model/body';
import type { BodyEdit } from '../../src/ops/types';

const NOTE = '---\nmtm-kind: action\n---\nDetails here.\n\n- [ ] One\n';

describe('applyBodyEdit', () => {
	it.each<[string, BodyEdit, string]>([
		['details', { kind: 'details', text: 'New text.' }, '---\nmtm-kind: action\n---\nNew text.\n\n- [ ] One\n'],
		['checklist', { kind: 'checklist', items: ['Two', 'Three'] }, '---\nmtm-kind: action\n---\nDetails here.\n\n- [ ] One\n- [ ] Two\n- [ ] Three\n'],
		['link', { kind: 'link', line: '[[Some note]]' }, '---\nmtm-kind: action\n---\nDetails here.\n\n- [ ] One\n\n[[Some note]]\n'],
	])('%s', (_, edit, expected) => {
		expect(applyBodyEdit(NOTE, edit)).toBe(expected);
	});

	it('keeps CRLF line endings', () => {
		const crlf = NOTE.replace(/\n/g, '\r\n');
		expect(applyBodyEdit(crlf, { kind: 'link', line: 'https://example.com' })).toBe('---\r\nmtm-kind: action\r\n---\r\nDetails here.\r\n\r\n- [ ] One\r\n\r\nhttps://example.com\r\n');
	});

	it('a line in an empty note, or after the frontmatter only', () => {
		expect(appendLine('', '[[A]]')).toBe('[[A]]\n');
		expect(appendLine('---\nx: 1\n---\n', '[[A]]')).toBe('---\nx: 1\n---\n[[A]]\n');
	});
});

describe('applyFrontmatterEdit', () => {
	it('sets and removes keys, leaving the rest', () => {
		const fm: Record<string, unknown> = { title: 'kept', 'mtm-status': 'next', 'mtm-order': 10 };
		applyFrontmatterEdit(fm, { path: 'x.md', set: { 'mtm-status': 'done', 'mtm-completed': '2026-10-09' }, remove: ['mtm-order'] });
		expect(fm).toEqual({ title: 'kept', 'mtm-status': 'done', 'mtm-completed': '2026-10-09' });
	});
});

describe('PlanBuilder', () => {
	it('edits only mtm- keys and reports each difference', () => {
		const b = new PlanBuilder();
		b.edit('a.md', { tags: ['x'], 'mtm-status': 'next', 'mtm-type': 'call' }, { tags: ['y'], 'mtm-status': 'doing', 'mtm-type': 'call' }, ['mtm-type']);
		expect(b.plan.edits).toEqual([{ path: 'a.md', set: { 'mtm-status': 'doing', 'mtm-type': 'call' }, remove: [] }]);
		expect(b.changes).toEqual([{ kind: 'property', path: 'a.md', key: 'mtm-status', from: 'next', to: 'doing' }]);
	});

	it('compares lists by value', () => {
		const b = new PlanBuilder();
		b.edit('a.md', { 'mtm-people': ['[[A]]'] }, { 'mtm-people': ['[[A]]'] });
		expect(b.plan.edits).toEqual([]);
	});
});
