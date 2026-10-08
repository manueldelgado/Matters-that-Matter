import { describe, expect, it } from 'vitest';
import { bestStrong, matchRanges, matchScore, normalise, rank } from '../../src/services/fuzzy';

describe('matchScore', () => {
	it('ignores case and accents', () => {
		expect(normalise('  Revisión  Anual ')).toBe('revision anual');
		expect(matchScore('revision', 'Revisión')).toBe(1);
	});

	it('ranks exact, first words, prefix, word prefixes and subsequences', () => {
		expect(matchScore('kitchen renovation', 'Kitchen renovation')).toBe(1);
		expect(matchScore('marco', 'Marco Rossi')).toBe(0.95);
		expect(matchScore('kit', 'Kitchen renovation')).toBe(0.9);
		expect(matchScore('reno', 'Kitchen renovation')).toBe(0.8);
		expect(matchScore('kit ren', 'Kitchen renovation')).toBe(0.8);
		expect(matchScore('ktchn', 'Kitchen')).toBe(0.4);
		expect(matchScore('garden', 'Kitchen')).toBe(0);
	});
});

describe('rank and bestStrong', () => {
	const people = [
		{ names: ['Marcos'], rank: 1 },
		{ names: ['Marco Rossi'], rank: 1 },
		{ names: ['Marco Polo'], rank: 0 },
	];

	it('prefers the better score, then the lower rank', () => {
		expect(rank('marco', people).map((r) => r.item.names[0])).toEqual(['Marco Polo', 'Marco Rossi', 'Marcos']);
	});

	it('returns only strong matches', () => {
		expect(bestStrong('mrc', people)).toBeNull();
		expect(bestStrong('rossi', people)?.names[0]).toBe('Marco Rossi');
	});
});

describe('matchRanges', () => {
	it('marks the prefix', () => {
		expect(matchRanges('kitch', 'Kitchen renovation')).toEqual([[0, 5]]);
	});

	it('marks word prefixes', () => {
		expect(matchRanges('kit ren', 'Kitchen renovation')).toEqual([
			[0, 3],
			[8, 11],
		]);
		expect(matchRanges('ross', 'Marco Rossi')).toEqual([[6, 10]]);
	});

	it('ignores accents and keeps offsets in the original name', () => {
		expect(matchRanges('luc', 'Lucía Romero')).toEqual([[0, 3]]);
		expect(matchRanges('lucia', 'Lucía Romero')).toEqual([[0, 5]]);
	});

	it('marks nothing for letters in order or no match', () => {
		expect(matchRanges('ktchn', 'Kitchen')).toEqual([]);
		expect(matchRanges('', 'Kitchen')).toEqual([]);
	});
});
