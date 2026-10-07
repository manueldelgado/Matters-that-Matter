import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, TONES } from '../src/settings';

describe('default settings', () => {
	const { statuses, types } = DEFAULT_SETTINGS;

	it('has exactly one backlog status, and it is not closed', () => {
		const backlog = statuses.filter((s) => s.backlog);
		expect(backlog).toHaveLength(1);
		expect(backlog[0]?.category).not.toBe('closed');
	});

	it('has exactly one done status, and it is closed', () => {
		const done = statuses.filter((s) => s.done);
		expect(done).toHaveLength(1);
		expect(done[0]?.category).toBe('closed');
	});

	it('has exactly one default type', () => {
		expect(types.filter((t) => t.default)).toHaveLength(1);
	});

	it('uses unique IDs made of lowercase letters, digits and hyphens', () => {
		for (const list of [statuses, types]) {
			const ids = list.map((item) => item.id);
			expect(new Set(ids).size).toBe(ids.length);
			for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
		}
	});

	it('uses palette tones only', () => {
		for (const item of [...statuses, ...types]) expect(TONES).toContain(item.tone);
	});
});
