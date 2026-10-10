import { describe, expect, it } from 'vitest';
import { COMPANION_THEME, companionThemeUri, usesCompanionTheme } from '../../src/services/companionTheme';

describe('companion theme', () => {
	it('is named Calm Matters', () => {
		expect(COMPANION_THEME).toBe('Calm Matters');
	});

	it('opens the theme browser at the theme', () => {
		expect(companionThemeUri()).toBe('obsidian://show-theme?name=Calm%20Matters');
	});

	it('is active only under its exact name', () => {
		expect(usesCompanionTheme('Calm Matters')).toBe(true);
		expect(usesCompanionTheme('')).toBe(false);
		expect(usesCompanionTheme('Minimal')).toBe(false);
		expect(usesCompanionTheme('calm matters')).toBe(false);
	});

	it('is unknown when the current theme cannot be read', () => {
		expect(usesCompanionTheme(null)).toBeNull();
	});
});
