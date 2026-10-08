import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { toActionItem } from '../../src/services/actionItems';
import { orphanSummary } from '../../src/services/orphanSummary';

const resolve = (text: string) => (text === 'Kitchen' ? { path: 'M/Kitchen.md', isMatter: true } : null);
const action = (title: string, fm: Record<string, unknown>) =>
	toActionItem(`A/${title}.md`, title, { 'mtm-kind': 'action', 'mtm-matter': '[[Kitchen]]', 'mtm-status': 'next', 'mtm-type': 'call', ...fm }, DEFAULT_SETTINGS, resolve);

describe('orphanSummary', () => {
	it('groups each unrecognised value once, with the value it gets and the count', () => {
		const summary = orphanSummary([
			action('Fine', {}),
			action('A', { 'mtm-status': 'someday' }),
			action('B', { 'mtm-status': 'someday', 'mtm-type': 'shop' }),
			action('C', { 'mtm-matter': '[[Garage]]' }),
			action('D', { 'mtm-status': 'maybe' }),
		]);
		expect(summary.items.map((i) => i.title)).toEqual(['A', 'B', 'C', 'D']);
		expect(summary.groups.map((g) => [g.field, g.raw, g.count, g.status?.id ?? g.type?.id ?? null])).toEqual([
			['status', 'someday', 2, 'later'],
			['status', 'maybe', 1, 'later'],
			['type', 'shop', 1, 'write'],
			['matter', '[[Garage]]', 1, null],
		]);
	});

	it('is empty when nothing is orphaned, and ignores absent values', () => {
		expect(orphanSummary([action('Fine', {}), action('Bare', { 'mtm-status': undefined, 'mtm-type': undefined })])).toEqual({ items: [], groups: [] });
	});
});
