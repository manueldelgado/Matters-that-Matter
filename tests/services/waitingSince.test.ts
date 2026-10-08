import { describe, expect, it } from 'vitest';
import { applyWaitingSince, WaitingCache, waitingSinceChange } from '../../src/services/waitingSince';

describe('waitingSinceChange', () => {
	it('sets the date when someone is set or changed', () => {
		expect(waitingSinceChange(null, 'Ana', false, false)).toBe('set');
		expect(waitingSinceChange('Ana', 'Marco', true, false)).toBe('set');
	});

	it('removes the date when the person is removed', () => {
		expect(waitingSinceChange('Ana', null, true, false)).toBe('remove');
		expect(waitingSinceChange('Ana', null, false, false)).toBe('none');
	});

	it('keeps a date set in the same edit', () => {
		expect(waitingSinceChange(null, 'Ana', true, true)).toBe('none');
		expect(waitingSinceChange('Ana', 'Marco', true, true)).toBe('none');
	});

	it('does nothing for the same person or an unknown previous value (no backfill)', () => {
		expect(waitingSinceChange('Ana', 'Ana', false, false)).toBe('none');
		expect(waitingSinceChange(undefined, 'Ana', false, false)).toBe('none');
	});
});

describe('applyWaitingSince', () => {
	it('follows the person in a plugin write', () => {
		const fm: Record<string, unknown> = {};
		applyWaitingSince(fm, null, 'Ana', '2026-10-08');
		expect(fm['mtm-waiting-since']).toBe('2026-10-08');
		applyWaitingSince(fm, 'Ana', null, '2026-10-09');
		expect('mtm-waiting-since' in fm).toBe(false);
	});
});

const ana = { key: 'People/Ana.md', text: 'Ana' };
const marco = { key: 'People/Marco.md', text: 'Marco' };

describe('WaitingCache', () => {
	it('never backfills: seeded values report no change', () => {
		const cache = new WaitingCache();
		cache.seed('a.md', ana, undefined);
		expect(cache.observe('a.md', ana, undefined, false)).toBe('none');
		expect(cache.observe('b.md', ana, undefined, false)).toBe('none');
	});

	it('reports hand edits against the cached person', () => {
		const cache = new WaitingCache();
		cache.seed('a.md', null, undefined);
		expect(cache.observe('a.md', ana, undefined, false)).toBe('set');
		// The plugin's own follow-up write: same person, date now present.
		expect(cache.observe('a.md', ana, '2026-10-08', true)).toBe('none');
		expect(cache.observe('a.md', marco, '2026-10-08', true)).toBe('set');
		expect(cache.observe('a.md', null, '2026-10-08', true)).toBe('remove');
	});

	it('follows renames', () => {
		const cache = new WaitingCache();
		cache.seed('a.md', ana, '2026-10-01');
		cache.rename('a.md', 'b.md');
		expect(cache.observe('b.md', null, '2026-10-01', true)).toBe('remove');
	});

	it('keeps the date when the person note is renamed, deleted or created later', () => {
		const cache = new WaitingCache();
		cache.seed('a.md', ana, '2026-09-15');
		cache.renamePerson('People/Ana.md', 'People/Ana Gil.md', 'Ana Gil');
		expect(cache.observe('a.md', { key: 'People/Ana Gil.md', text: 'Ana Gil' }, '2026-09-15', true)).toBe('none');
		// Deleted: the key falls back to the link text.
		expect(cache.observe('a.md', { key: 'Ana Gil', text: 'Ana Gil' }, '2026-09-15', true)).toBe('none');
		// Created again: the link resolves to a path.
		expect(cache.observe('a.md', { key: 'People/Ana Gil.md', text: 'Ana Gil' }, '2026-09-15', true)).toBe('none');
	});
});
