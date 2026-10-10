import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type MattersSettings } from '../../src/settings';
import { applyControlValue, CONTROL_KEYS, isControlKey, readControlValue } from '../../src/services/settingsControls';

const fresh = (): MattersSettings => structuredClone(DEFAULT_SETTINGS);

/**
 * For each control: what it reads from the default settings, a valid value other than that,
 * the settings that value changes, and invalid values with what each becomes.
 */
const CASES: Record<
	(typeof CONTROL_KEYS)[number],
	{ read: unknown; valid: unknown; changes: Partial<MattersSettings>; invalid: [unknown, unknown][] }
> = {
	defaultInboxPosition: { read: 'top', valid: 'bottom', changes: { defaultInboxPosition: 'bottom' }, invalid: [['middle', 'top'], [undefined, 'top'], [1, 'top']] },
	showDone: { read: true, valid: false, changes: { showDone: false }, invalid: [['true', false], [1, false], [undefined, false]] },
	weekStart: { read: 'monday', valid: 'sunday', changes: { weekStart: 'sunday' }, invalid: [['tuesday', 'monday'], [null, 'monday'], [0, 'monday']] },
	openMattersAsOverview: { read: true, valid: false, changes: { openMattersAsOverview: false }, invalid: [['yes', false], [1, false], [null, false]] },
	inlineChips: { read: true, valid: false, changes: { inlineChips: false }, invalid: [['true', false], [1, false], [undefined, false]] },
	todayInNewTabs: { read: 'every', valid: 'alone', changes: { todayInNewTabs: 'alone' }, invalid: [['never', 'every'], [undefined, 'every'], [false, 'every']] },
	datesEnglish: { read: true, valid: false, changes: { dateLanguages: ['es'] }, invalid: [['true', false], [1, false], [undefined, false]] },
	datesSpanish: { read: true, valid: false, changes: { dateLanguages: ['en'] }, invalid: [['true', false], [1, false], [undefined, false]] },
};

describe('settings controls', () => {
	it('has a control for each built-in setting the tab shows (keep in step with its control() calls)', () => {
		expect([...CONTROL_KEYS].sort()).toEqual(
			['datesEnglish', 'datesSpanish', 'defaultInboxPosition', 'inlineChips', 'openMattersAsOverview', 'showDone', 'todayInNewTabs', 'weekStart'],
		);
	});

	it.each(CONTROL_KEYS.map((key) => [key]))('%s reads its setting', (key) => {
		expect(readControlValue(fresh(), key)).toEqual(CASES[key].read);
	});

	it.each(CONTROL_KEYS.map((key) => [key]))('%s applies a valid value, changing only its setting', (key) => {
		const settings = fresh();
		const { valid, changes } = CASES[key];
		expect(applyControlValue(settings, key, valid)).toBe('applied');
		expect(readControlValue(settings, key)).toBe(valid);
		expect(settings).toEqual({ ...DEFAULT_SETTINGS, ...changes });
	});

	it.each(CONTROL_KEYS.flatMap((key) => CASES[key].invalid.map(([value, expected]) => [key, value, expected])))(
		'%s coerces %o to %o',
		(key, value, expected) => {
			const settings = fresh();
			expect(applyControlValue(settings, key as string, value)).toBe('applied');
			expect(readControlValue(settings, key as string)).toBe(expected);
		},
	);

	it('applies only the control it names', () => {
		const settings = fresh();
		applyControlValue(settings, 'weekStart', 'sunday');
		expect({ ...settings, weekStart: DEFAULT_SETTINGS.weekStart }).toEqual(DEFAULT_SETTINGS);
	});

	it('round-trips "Show links to Actions as chips" off and on', () => {
		const settings = fresh();
		expect(readControlValue(settings, 'inlineChips')).toBe(true);
		expect(applyControlValue(settings, 'inlineChips', false)).toBe('applied');
		expect(settings.inlineChips).toBe(false);
		expect(readControlValue(settings, 'inlineChips')).toBe(false);
		expect(applyControlValue(settings, 'inlineChips', true)).toBe('applied');
		expect(settings.inlineChips).toBe(true);
	});

	describe('date languages', () => {
		it('turns a language off and on again, keeping English before Spanish', () => {
			const settings = fresh();
			expect(applyControlValue(settings, 'datesEnglish', false)).toBe('applied');
			expect(settings.dateLanguages).toEqual(['es']);
			expect(readControlValue(settings, 'datesEnglish')).toBe(false);
			expect(readControlValue(settings, 'datesSpanish')).toBe(true);
			expect(applyControlValue(settings, 'datesEnglish', true)).toBe('applied');
			expect(settings.dateLanguages).toEqual(['en', 'es']);
		});

		it('turning on a language that is already on changes nothing', () => {
			const settings = fresh();
			expect(applyControlValue(settings, 'datesSpanish', true)).toBe('applied');
			expect(settings.dateLanguages).toEqual(['en', 'es']);
		});

		it.each([
			['datesEnglish', ['en']],
			['datesSpanish', ['es']],
		] as const)('refuses turning off %s when it is the only language on', (key, only) => {
			const settings = { ...fresh(), dateLanguages: [...only] };
			expect(applyControlValue(settings, key, false)).toBe('refused');
			expect(settings.dateLanguages).toEqual(only);
			expect(readControlValue(settings, key)).toBe(true);
		});

		it('refuses an invalid value that would turn off the only language on', () => {
			const settings = { ...fresh(), dateLanguages: ['es' as const] };
			expect(applyControlValue(settings, 'datesSpanish', 'yes')).toBe('refused');
			expect(settings.dateLanguages).toEqual(['es']);
		});

		it('writes a new list rather than changing the old one', () => {
			const settings = fresh();
			const before = settings.dateLanguages;
			applyControlValue(settings, 'datesSpanish', false);
			expect(before).toEqual(['en', 'es']);
			expect(settings.dateLanguages).toEqual(['en']);
		});
	});

	it.each([['unknown'], ['folders.matters'], ['dateLanguages'], ['schemaVersion'], ['toString'], ['__proto__'], ['']])(
		'refuses %o, changing nothing',
		(key) => {
			const settings = fresh();
			expect(isControlKey(key)).toBe(false);
			expect(applyControlValue(settings, key, 'x')).toBe('unknown');
			expect(readControlValue(settings, key)).toBeUndefined();
			expect(settings).toEqual(DEFAULT_SETTINGS);
		},
	);
});
