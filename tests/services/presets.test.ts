import { describe, expect, it } from 'vitest';
import { areContexts, matchPreset, PRESET_IDS, presetStatuses, presetTypes, workflowLosses } from '../../src/services/presets';
import { checkFlags } from '../../src/model/workflow';
import { DEFAULT_SETTINGS } from '../../src/settings';

describe('presets', () => {
	it('default is the default workflow; simple is Later, Doing, Done', () => {
		expect(presetStatuses('default')).toEqual(DEFAULT_SETTINGS.statuses);
		expect(presetStatuses('simple').map((s) => s.label)).toEqual(['Later', 'Doing', 'Done']);
	});

	it('every preset has valid flags', () => {
		for (const id of PRESET_IDS) expect(checkFlags(presetStatuses(id), presetTypes(id))).toEqual([]);
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

	it('Get stuff done keeps Someday apart and brings contexts as types', () => {
		expect(presetStatuses('next').map((s) => s.label)).toEqual(['Someday', 'Next', 'Doing', 'Waiting', 'Done']);
		expect(presetStatuses('next').find((s) => s.backlog)?.id).toBe('someday');
		const types = presetTypes('next');
		expect(types.map((t) => t.label)).toEqual(['Calls', 'Computer', 'Errands', 'Home', 'Agendas', 'Anywhere']);
		expect(types.find((t) => t.default)?.id).toBe('computer');
		expect(areContexts(types)).toBe(true);
		expect(matchPreset(presetStatuses('next'))).toBe('next');
	});

	it('the other presets bring the default types', () => {
		for (const id of ['default', 'simple', 'custom'] as const) expect(presetTypes(id)).toEqual(DEFAULT_SETTINGS.types);
	});
});

describe('workflowLosses', () => {
	const current = { statuses: presetStatuses('default'), types: presetTypes('default') };
	const next = { statuses: presetStatuses('next'), types: presetTypes('next') };

	it('counts Actions whose valid status or type the chosen workflow lacks', () => {
		const losses = workflowLosses(
			[
				{ status: 'later', type: 'call' },
				{ status: 'later', type: 'write' },
				{ status: 'next', type: undefined },
				{ status: 'nowhere', type: 'nope' },
			],
			current,
			next,
		);
		expect(losses.actions).toBe(2);
		expect(losses.statuses).toEqual([{ label: 'Later', count: 2 }]);
		expect(losses.types).toEqual([
			{ label: 'Call', count: 1 },
			{ label: 'Write', count: 1 },
		]);
	});

	it('finds nothing when the workflow keeps its IDs', () => {
		expect(workflowLosses([{ status: 'later', type: 'call' }], current, current)).toEqual({ actions: 0, statuses: [], types: [] });
	});
});
