import { describe, expect, it } from 'vitest';
import { classId, idFromLabel, slug } from '../../src/services/ids';

describe('slug', () => {
	it('lowercases and joins words with hyphens', () => {
		expect(slug('Follow up')).toBe('follow-up');
	});

	it('drops accents and other characters', () => {
		expect(slug('Revisión  final!')).toBe('revision-final');
		expect(slug('  --Call/Text--  ')).toBe('call-text');
	});
});

describe('idFromLabel', () => {
	it('uses the slug when it is free', () => {
		expect(idFromLabel('Waiting for', ['later', 'next'])).toBe('waiting-for');
	});

	it('adds a numeric suffix on collision', () => {
		expect(idFromLabel('Next', ['next'])).toBe('next-2');
		expect(idFromLabel('Next', ['next', 'next-2'])).toBe('next-3');
	});

	it('falls back to "item" for labels without letters or digits', () => {
		expect(idFromLabel('¿¿??', [])).toBe('item');
		expect(idFromLabel('!!!', ['item'])).toBe('item-2');
	});

	it('reuses the ID of a deleted item', () => {
		expect(idFromLabel('Buy', ['call', 'write'])).toBe('buy');
	});
});

describe('classId', () => {
	it('sanitises raw values for class names', () => {
		expect(classId('Some Day')).toBe('some-day');
		expect(classId('***')).toBe('_');
	});
});
