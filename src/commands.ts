// Command palette entries. No default hotkeys.

import { Notice, TFolder } from 'obsidian';
import type MattersPlugin from './main';
import { STRINGS } from './strings';
import { ConfirmModal } from './ui/modals/confirmModal';
import { SAMPLE_FOLDER } from './services/setupPlan';
import { frontmatterOf } from './vault/notes';

export function registerCommands(plugin: MattersPlugin): void {
	plugin.addCommand({
		id: 'new-matter',
		name: STRINGS.commands.newMatter,
		callback: () => plugin.newMatter(),
	});

	plugin.addCommand({
		id: 'run-setup',
		name: STRINGS.commands.runSetup,
		callback: () => void plugin.openSetup(),
	});

	plugin.addCommand({
		id: 'open-board',
		name: STRINGS.commands.openBoard,
		callback: () => void plugin.openBoard(),
	});

	plugin.addCommand({
		id: 'remove-sample-content',
		name: STRINGS.commands.removeSample,
		callback: () => removeSampleContent(plugin),
	});
}

function removeSampleContent(plugin: MattersPlugin): void {
	const { app } = plugin;
	const files = app.vault.getMarkdownFiles().filter((f) => frontmatterOf(app, f)?.['mtm-sample'] === true);
	if (!files.length) {
		new Notice(STRINGS.notices.noSample);
		return;
	}
	new ConfirmModal(app, {
		title: STRINGS.modals.removeSampleTitle,
		body: STRINGS.modals.removeSampleBody(files.length),
		confirm: STRINGS.modals.remove,
		danger: true,
		onConfirm: async () => {
			for (const file of files) await app.fileManager.trashFile(file);
			const folder = app.vault.getAbstractFileByPath(SAMPLE_FOLDER);
			if (folder instanceof TFolder && folder.children.length === 0) await app.fileManager.trashFile(folder);
			new Notice(STRINGS.notices.sampleRemoved(files.length));
		},
	}).open();
}
