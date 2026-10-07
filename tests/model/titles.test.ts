import { describe, expect, it } from 'vitest';
import { MAX_TITLE_LENGTH, sanitiseTitle, uniqueTitle } from '../../src/model/titles';

describe('sanitiseTitle', () => {
	it('removes characters that break file names or links', () => {
		expect(sanitiseTitle('Call Marco: quote #2 [draft] a/b')).toBe('Call Marco quote 2 draft a b');
		expect(sanitiseTitle('What? *Now* <ok> | "x" ^y \\z')).toBe('What Now ok x y z');
	});

	it('collapses whitespace and trims', () => {
		expect(sanitiseTitle('  Buy   paint \n now ')).toBe('Buy paint now');
	});

	it('removes leading dots', () => {
		expect(sanitiseTitle('...hidden')).toBe('hidden');
	});

	it('caps the length at 100 characters', () => {
		const long = 'word '.repeat(40);
		const title = sanitiseTitle(long);
		expect(Array.from(title).length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
		expect(title.endsWith(' ')).toBe(false);
	});

	it('does not split emoji when capping', () => {
		const title = sanitiseTitle('😀'.repeat(120));
		expect(Array.from(title)).toHaveLength(100);
	});
});

describe('uniqueTitle', () => {
	it('keeps a free title', () => {
		expect(uniqueTitle('Call Marco', () => false)).toBe('Call Marco');
	});

	it('appends " 2", " 3"… on collision', () => {
		const taken = new Set(['Call Marco', 'Call Marco 2']);
		expect(uniqueTitle('Call Marco', (t) => taken.has(t))).toBe('Call Marco 3');
	});

	it('keeps the result within the length cap', () => {
		const title = 'x'.repeat(100);
		const result = uniqueTitle(title, (t) => t === title);
		expect(result).toHaveLength(100);
		expect(result.endsWith(' 2')).toBe(true);
	});
});
