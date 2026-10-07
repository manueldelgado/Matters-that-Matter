// Workflow presets offered by the setup wizard.

import { DEFAULT_SETTINGS, type StatusDef } from '../settings';

export type PresetId = 'default' | 'simple' | 'custom';

const SIMPLE: StatusDef[] = [
	{ id: 'later', label: 'Later', tone: 'ink', category: 'open', backlog: true },
	{ id: 'doing', label: 'Doing', tone: 'butter', category: 'active' },
	{ id: 'done', label: 'Done', tone: 'mint', category: 'closed', done: true },
];

/** The statuses of a preset; custom starts from the default workflow. */
export function presetStatuses(id: PresetId): StatusDef[] {
	return structuredClone(id === 'simple' ? SIMPLE : DEFAULT_SETTINGS.statuses);
}

const sameStatuses = (a: readonly StatusDef[], b: readonly StatusDef[]) => JSON.stringify(a) === JSON.stringify(b);

/** The preset a workflow matches, or custom after any edit. */
export function matchPreset(statuses: readonly StatusDef[]): PresetId {
	if (sameStatuses(statuses, presetStatuses('default'))) return 'default';
	if (sameStatuses(statuses, presetStatuses('simple'))) return 'simple';
	return 'custom';
}
