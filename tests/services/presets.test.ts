import { describe, expect, it } from 'vitest';
import { matchPreset, presetStatuses } from '../../src/services/presets';
import { checkFlags } from '../../src/model/workflow';
import { DEFAULT_SETTINGS } from '../../src/settings';

describe('presets', () => {
	it('default is the default workflow; simple is Later, Doing, Done', () => {
		expect(presetStatuses('default')).toEqual(DEFAULT_SETTINGS.statuses);
		expect(presetStatuses('simple').map((s) => s.label)).toEqual(['Later', 'Doing', 'Done']);
	});

	it('every preset has valid flags', () => {
		for (const id of ['default', 'simple', 'custom'] as const) expect(checkFlags(presetStatuses(id), DEFAULT_SETTINGS.types)).toEqual([]);
	});

	it('returns copies', () => {
		presetStatuses('default')[0]!.label = 'Changed';
		expect(presetStatuses('default')[0]?.label).toBe('Later');
	});

	it('recognises a preset, and anything edited as custom', () => {
		expect(matchPreset(presetStatuses('simple'))).toBe('simple');
		const edited = presetStatuses('default');
		edited[1]!.label = 'Soon';
		expect(matchPreset(edited)).toBe('custom');
	});
});
