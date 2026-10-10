import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type MattersSettings } from '../../src/settings';
import { applyControlValue, CONTROL_KEYS, isControlKey, readControlValue } from '../../src/services/settingsControls';

const fresh = (): MattersSettings => structuredClone(DEFAULT_SETTINGS);

/** For each control: a valid value other than the default, and invalid values with what each becomes. */
const CASES: Record<(typeof CONTROL_KEYS)[number], { valid: unknown; invalid: [unknown, unknown][] }> = {
	defaultInboxPosition: { valid: 'bottom', invalid: [['middle', 'top'], [undefined, 'top'], [1, 'top']] },
	showDone: { valid: false, invalid: [['true', false], [1, false], [undefined, false]] },
	weekStart: { valid: 'sunday', invalid: [['tuesday', 'monday'], [null, 'monday'], [0, 'monday']] },
	openMattersAsOverview: { valid: false, invalid: [['yes', false], [1, false], [null, false]] },
	inlineChips: { valid: false, invalid: [['true', false], [1, false], [undefined, false]] },
	todayInNewTabs: { valid: 'alone', invalid: [['never', 'every'], [undefined, 'every'], [false, 'every']] },
};

describe('settings controls', () => {
	it('has a control for each built-in setting the tab shows (keep in step with its control() calls)', () => {
		expect([...CONTROL_KEYS].sort()).toEqual(
			['defaultInboxPosition', 'inlineChips', 'openMattersAsOverview', 'showDone', 'todayInNewTabs', 'weekStart'],
		);
	});

	it.each(CONTROL_KEYS.map((key) => [key]))('%s reads its setting', (key) => {
		const settings = fresh();
		expect(readControlValue(settings, key)).toEqual(settings[key as keyof MattersSettings]);
	});

	it.each(CONTROL_KEYS.map((key) => [key]))('%s applies a valid value and returns true', (key) => {
		const settings = fresh();
		const { valid } = CASES[key];
		expect(applyControlValue(settings, key, valid)).toBe(true);
		expect(readControlValue(settings, key)).toBe(valid);
		expect(settings[key as keyof MattersSettings]).toBe(valid);
	});

	it.each(CONTROL_KEYS.flatMap((key) => CASES[key].invalid.map(([value, expected]) => [key, value, expected])))(
		'%s coerces %o to %o',
		(key, value, expected) => {
			const settings = fresh();
			expect(applyControlValue(settings, key as string, value)).toBe(true);
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
		expect(applyControlValue(settings, 'inlineChips', false)).toBe(true);
		expect(settings.inlineChips).toBe(false);
		expect(readControlValue(settings, 'inlineChips')).toBe(false);
		expect(applyControlValue(settings, 'inlineChips', true)).toBe(true);
		expect(settings.inlineChips).toBe(true);
	});

	it.each([['unknown'], ['folders.matters'], ['dateLanguages'], ['schemaVersion'], ['toString'], ['__proto__'], ['']])(
		'refuses %o, changing nothing',
		(key) => {
			const settings = fresh();
			expect(isControlKey(key)).toBe(false);
			expect(applyControlValue(settings, key, 'x')).toBe(false);
			expect(readControlValue(settings, key)).toBeUndefined();
			expect(settings).toEqual(DEFAULT_SETTINGS);
		},
	);
});
