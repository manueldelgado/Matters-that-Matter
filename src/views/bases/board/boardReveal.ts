// Show on board: hands a pending reveal to the board in the tab that shows the board file.

import { Notice, parseYaml, type TFile, type WorkspaceLeaf } from 'obsidian';
import type MattersPlugin from '../../../main';
import { STRINGS } from '../../../strings';
import { firstViewName, VIEW_TYPES } from '../../../services/baseFile';
import { REVEAL_WAIT_MS } from '../../../services/reveal';
import { basesViewType, selectBasesView } from '../../../vault/internal';

const POLL_MS = 100;

/**
 * A board already in the tab renders again to take the reveal; one still loading takes it after its first render;
 * another view of the file is switched to the file's first board view. While the tab is still loading, this waits
 * as long as the reveal does; a tab whose view can't be read is left alone (the reveal expires silently).
 */
export async function handReveal(plugin: MattersPlugin, leaf: WorkspaceLeaf, file: TFile): Promise<void> {
	for (let waited = 0; waited < REVEAL_WAIT_MS; waited += POLL_MS) {
		if (!plugin.hasPendingReveal()) return;
		const board = [...plugin.boards].find((b) => b.isWithin(leaf.view.containerEl));
		if (board) {
			board.revealNow();
			return;
		}
		const type = basesViewType(leaf);
		if (type !== null && type !== VIEW_TYPES.board) {
			await switchToBoardView(plugin, leaf, file);
			return;
		}
		await sleep(POLL_MS);
	}
}

/** Switches a tab showing another view of a board file to the file's first board view, as its view selector would. */
async function switchToBoardView(plugin: MattersPlugin, leaf: WorkspaceLeaf, file: TFile): Promise<void> {
	let name: string | null = null;
	try {
		name = firstViewName(parseYaml(await plugin.app.vault.cachedRead(file)), VIEW_TYPES.board);
	} catch (e) {
		console.warn('Matters that Matter: could not read the board file', e);
	}
	if (!name || !(await selectBasesView(leaf, name))) new Notice(STRINGS.reveal.switchView);
}
