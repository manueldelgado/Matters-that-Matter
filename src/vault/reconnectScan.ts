// What reconnecting setup reads from the vault: Actions, Matters and the boards that use an MTM view.

import type { App } from 'obsidian';
import { VIEW_TYPES } from '../services/baseFile';
import type { VaultScan } from '../services/reconnect';
import { peoplePaths } from './index';
import { frontmatterOf, notesOfKind } from './notes';

const MTM_VIEW = new RegExp(`type:\\s*(${Object.values(VIEW_TYPES).join('|')})\\b`);

export async function scanVault(app: App): Promise<VaultScan> {
	const sample = (fm: Record<string, unknown> | undefined) => fm?.['mtm-sample'] === true;
	const actions = notesOfKind(app, 'action').map((file) => {
		const fm = frontmatterOf(app, file) ?? {};
		return {
			path: file.path,
			status: fm['mtm-status'],
			type: fm['mtm-type'],
			completed: fm['mtm-completed'],
			sample: sample(fm),
			people: [...peoplePaths(app, fm, file.path)],
		};
	});
	const matters = notesOfKind(app, 'matter').map((file) => {
		const fm = frontmatterOf(app, file);
		return { path: file.path, sphere: fm?.['mtm-sphere'], icon: fm?.['mtm-icon'], sample: sample(fm) };
	});
	const boards: string[] = [];
	for (const file of app.vault.getFiles()) {
		if (file.extension !== 'base') continue;
		try {
			if (MTM_VIEW.test(await app.vault.cachedRead(file))) boards.push(file.path);
		} catch {
			// Unreadable: not a board we can reuse.
		}
	}
	return { actions, matters, boards };
}
