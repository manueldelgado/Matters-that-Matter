import { describe, expect, it } from 'vitest';
import { applyStatus, completionChange, StatusCache } from '../../src/services/completion';
import { DEFAULT_SETTINGS } from '../../src/settings';

describe('completionChange', () => {
	it('sets the date when entering closed, if absent', () => {
		expect(completionChange('active', 'closed', false)).toBe('set');
		expect(completionChange('open', 'closed', true)).toBe('none');
	});

	it('removes the date when leaving closed, if present', () => {
		expect(completionChange('closed', 'open', true)).toBe('remove');
		expect(completionChange('closed', 'active', false)).toBe('none');
	});

	it('ignores changes within the same category, and between open and active', () => {
		expect(completionChange('closed', 'closed', false)).toBe('none');
		expect(completionChange('open', 'active', false)).toBe('none');
	});

	it('does nothing without a known previous category (no backfill)', () => {
		expect(completionChange(undefined, 'closed', false)).toBe('none');
	});
});

describe('StatusCache', () => {
	it('does not backfill: seeding on load never reports a change', () => {
		const cache = new StatusCache();
		cache.seed('a.md', 'closed');
		expect(cache.observe('a.md', 'closed', false)).toBe('none');
	});

	it('reports observed transitions and remembers the new category', () => {
		const cache = new StatusCache();
		cache.seed('a.md', 'open');
		expect(cache.observe('a.md', 'closed', false)).toBe('set');
		expect(cache.get('a.md')).toBe('closed');
		expect(cache.observe('a.md', 'open', true)).toBe('remove');
	});

	it("ignores the plugin's own writes once seeded", () => {
		const cache = new StatusCache();
		cache.seed('a.md', 'open');
		// The plugin writes the done status and mtm-completed together, then seeds.
		cache.seed('a.md', 'closed');
		expect(cache.observe('a.md', 'closed', true)).toBe('none');
	});

	it('treats a new file as unknown', () => {
		expect(new StatusCache().observe('new.md', 'closed', false)).toBe('none');
	});

	it('follows renames and deletions', () => {
		const cache = new StatusCache();
		cache.seed('a.md', 'open');
		cache.rename('a.md', 'b.md');
		expect(cache.get('a.md')).toBeUndefined();
		expect(cache.observe('b.md', 'closed', false)).toBe('set');
		cache.forget('b.md');
		expect(cache.get('b.md')).toBeUndefined();
	});
});

describe('applyStatus', () => {
	const status = (id: string) => DEFAULT_SETTINGS.statuses.find((s) => s.id === id)!;
	const [later, doing, done] = [status('later'), status('doing'), status('done')];

	it('sets the status and the completion date when closing', () => {
		const fm: Record<string, unknown> = { 'mtm-status': 'doing' };
		applyStatus(fm, done, 'active', '2026-10-09');
		expect(fm).toEqual({ 'mtm-status': 'done', 'mtm-completed': '2026-10-09' });
	});

	it('removes the completion date when reopening', () => {
		const fm: Record<string, unknown> = { 'mtm-status': 'done', 'mtm-completed': '2026-10-01' };
		applyStatus(fm, later, 'closed', '2026-10-09');
		expect(fm).toEqual({ 'mtm-status': 'later' });
	});

	it('keeps an existing completion date and leaves open-to-active alone', () => {
		const closed: Record<string, unknown> = { 'mtm-completed': '2026-10-01' };
		applyStatus(closed, done, 'open', '2026-10-09');
		expect(closed['mtm-completed']).toBe('2026-10-01');
		const open: Record<string, unknown> = {};
		applyStatus(open, doing, 'open', '2026-10-09');
		expect(open).toEqual({ 'mtm-status': 'doing' });
	});
});
