// Command palette entries. No default hotkeys.

import { normalizePath, Notice, TFolder } from 'obsidian';
import type MattersPlugin from './main';
import { STRINGS } from './strings';
import { ConfirmModal } from './ui/modals/confirmModal';
import { SAMPLE_FILE_PATHS, SAMPLE_FOLDER, spheresWithoutSample } from './services/samplePackage';
import { frontmatterOf } from './vault/notes';
import { markReviewed } from './vault/matterWrites';
import { dismissOrphan } from './vault/actionWrites';
import { allActionItems } from './vault/index';
import { orphanSummary } from './services/orphanSummary';
import { FixOrphansModal } from './ui/modals/fixOrphansModal';

export function registerCommands(plugin: MattersPlugin): void {
	plugin.addCommand({
		id: 'quick-add',
		name: STRINGS.commands.quickAdd,
		checkCallback: (checking) => {
			if (!plugin.settings.setupDone) return false;
			if (!checking) plugin.quickAdd();
			return true;
		},
	});

	plugin.addCommand({
		id: 'process-inbox',
		name: STRINGS.commands.processInbox,
		checkCallback: (checking) => {
			if (!plugin.settings.setupDone) return false;
			if (!checking) plugin.processInbox();
			return true;
		},
	});

	plugin.addCommand({
		id: 'review-matters',
		name: STRINGS.commands.reviewMatters,
		checkCallback: (checking) => {
			if (!plugin.settings.setupDone) return false;
			// From a board focused on one Sphere, only its Matters.
			if (!checking) plugin.reviewMatters({ sphereId: plugin.activeBoardSphere() });
			return true;
		},
	});

	plugin.addCommand({
		id: 'new-matter',
		name: STRINGS.commands.newMatter,
		// No writes before setup is done.
		checkCallback: (checking) => {
			if (!plugin.settings.setupDone) return false;
			if (!checking) plugin.newMatter();
			return true;
		},
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
		id: 'mark-as-done',
		name: STRINGS.commands.markDone,
		checkCallback: (checking) => {
			const file = plugin.settings.setupDone ? plugin.currentAction() : null;
			if (!file || plugin.isClosed(file)) return false;
			if (!checking) void plugin.markDone(file);
			return true;
		},
	});

	plugin.addCommand({
		id: 'open-matter-overview',
		name: STRINGS.commands.openOverview,
		checkCallback: (checking) => {
			const file = plugin.settings.setupDone ? plugin.app.workspace.activeEditor?.file ?? null : null;
			if (!plugin.isMatter(file)) return false;
			if (!checking) void plugin.openMatter(file.path);
			return true;
		},
	});

	plugin.addCommand({
		id: 'mark-as-reviewed',
		name: STRINGS.commands.markReviewed,
		checkCallback: (checking) => {
			const file = plugin.settings.setupDone ? plugin.currentMatter() : null;
			// The Inbox is not reviewed.
			if (!file || file.path === plugin.settings.inboxPath) return false;
			if (!checking) {
				void markReviewed(plugin.app, file).catch((e) => {
					new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
				});
			}
			return true;
		},
	});

	plugin.addCommand({
		id: 'fix-orphaned-actions',
		name: STRINGS.commands.fixOrphans,
		checkCallback: (checking) => {
			if (!plugin.settings.setupDone) return false;
			if (!checking) fixOrphanedActions(plugin);
			return true;
		},
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
			for (const path of SAMPLE_FILE_PATHS) {
				const file = app.vault.getFileByPath(path);
				if (file) await app.fileManager.trashFile(file);
			}
			await trashEmptyFolders(plugin, SAMPLE_FOLDER);
			// The sample's Spheres go too, unless a Matter still uses them or the user changed them.
			const used = new Set<string>();
			for (const f of app.vault.getMarkdownFiles()) {
				const fm = frontmatterOf(app, f);
				if (fm?.['mtm-kind'] === 'matter' && typeof fm['mtm-sphere'] === 'string') used.add(fm['mtm-sphere']);
			}
			const spheres = spheresWithoutSample(plugin.settings.spheres, used);
			if (spheres.length !== plugin.settings.spheres.length) {
				plugin.settings.spheres = spheres;
				await plugin.saveSettings();
			}
			new Notice(STRINGS.notices.sampleRemoved(files.length));
		},
	}).open();
}

/** Trashes a folder whose subfolders hold nothing, deepest first. */
async function trashEmptyFolders(plugin: MattersPlugin, path: string): Promise<void> {
	const folder = plugin.app.vault.getFolderByPath(path);
	if (!folder) return;
	for (const child of [...folder.children]) if (child instanceof TFolder) await trashEmptyFolders(plugin, child.path);
	if (folder.children.length === 0) await plugin.app.fileManager.trashFile(folder);
}

/** Writes the fallback values to every orphaned Action, after a confirmation listing what changes. */
function fixOrphanedActions(plugin: MattersPlugin): void {
	const { app, settings } = plugin;
	const summary = orphanSummary(allActionItems(app, settings));
	if (!summary.items.length) {
		new Notice(STRINGS.fixOrphans.none);
		return;
	}
	const inbox = app.vault.getFileByPath(normalizePath(settings.inboxPath));
	const inboxName = inbox?.basename ?? settings.inboxPath.split('/').pop()?.replace(/\.md$/i, '') ?? settings.inboxPath;
	new FixOrphansModal(app, summary, inboxName, async () => {
		let fixed = 0;
		let failed = 0;
		for (const item of summary.items) {
			const file = app.vault.getFileByPath(item.path);
			if (!file) continue;
			try {
				await dismissOrphan(app, file, settings);
				fixed++;
			} catch (e) {
				failed++;
				console.error('Matters that Matter: could not fix', item.path, e);
			}
		}
		new Notice(failed ? `${STRINGS.fixOrphans.fixed(fixed)} ${STRINGS.fixOrphans.failed(failed)}` : STRINGS.fixOrphans.fixed(fixed));
	}).open();
}
