import { Events, normalizePath, Notice, Plugin, TFile, TFolder } from 'obsidian';
import type { MattersSettings } from './settings';
import { STRINGS } from './strings';
import { migrateSettings } from './services/migrations';
import { backlogStatus, defaultType } from './model/workflow';
import { registerCommands } from './commands';
import { Selection } from './selection';
import { MattersSettingTab } from './ui/settingsTab';
import { BoardPicker } from './ui/modals/boardPicker';
import { NewMatterModal } from './ui/modals/newMatterModal';
import { registerCollectionViews } from './views/bases/registerViews';
import { SetupView, VIEW_SETUP } from './views/setup/setupView';
import { ensureDateTimeTypes } from './vault/internal';
import { frontmatterOf } from './vault/notes';
import { createAction } from './vault/actionWrites';
import { createMatter } from './vault/matterWrites';
import { Watchers } from './vault/watchers';

export default class MattersPlugin extends Plugin {
	settings!: MattersSettings;
	/** "settings-changed" fires after every save and after settings arrive from sync. */
	events = new Events();
	selection = new Selection();
	basesAvailable = false;
	private watchers: Watchers | null = null;
	private ribbonEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_SETUP, (leaf) => new SetupView(leaf, this));
		this.basesAvailable = registerCollectionViews(this);
		registerCommands(this);
		this.addSettingTab(new MattersSettingTab(this.app, this));
		this.ribbonEl = this.addRibbonIcon('square-kanban', STRINGS.ribbon, () => void this.openBoard());
		this.ribbonEl.addClass('mtm-ribbon');

		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => void this.onRename(file.path, oldPath)));
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file && frontmatterOf(this.app, file)?.['mtm-kind'] === 'action') this.selection.set(file.path);
			}),
		);
		this.app.workspace.onLayoutReady(() => this.onLayoutReady());
	}

	private onLayoutReady(): void {
		if (!this.settings.setupDone) {
			void this.openSetup();
			return;
		}
		this.onSetupDone();
		if (!this.basesAvailable) new Notice(STRINGS.notices.basesDisabled);
	}

	/** Starts what only runs once setup is done (also called when setup completes). */
	onSetupDone(): void {
		ensureDateTimeTypes(this.app);
		if (this.watchers || !this.ribbonEl) return;
		this.watchers = new Watchers(this);
		this.watchers.start(this.ribbonEl);
	}

	async loadSettings() {
		this.settings = migrateSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.events.trigger('settings-changed');
	}

	async onExternalSettingsChange() {
		await this.loadSettings();
		this.events.trigger('settings-changed');
	}

	/** The Inbox and the board are identified by their paths; follow renames. */
	private async onRename(path: string, oldPath: string): Promise<void> {
		let changed = false;
		if (oldPath === this.settings.inboxPath) {
			this.settings.inboxPath = path;
			changed = true;
		}
		if (oldPath === this.settings.boardPath) {
			this.settings.boardPath = path;
			changed = true;
		}
		if (changed) await this.saveSettings();
	}

	async openSetup(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_SETUP)[0];
		if (existing) {
			await workspace.revealLeaf(existing);
			return;
		}
		const leaf = workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_SETUP, active: true });
		await workspace.revealLeaf(leaf);
	}

	/** Opens the board file, or a picker when the boards folder holds several. */
	async openBoard(): Promise<void> {
		const { vault, workspace } = this.app;
		const folder = vault.getAbstractFileByPath(normalizePath(this.settings.folders.boards));
		const boards =
			folder instanceof TFolder ? folder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'base') : [];
		const open = (file: TFile) => void workspace.getLeaf(false).openFile(file);

		if (boards.length > 1) {
			new BoardPicker(this.app, boards, open).open();
			return;
		}
		const board = vault.getFileByPath(normalizePath(this.settings.boardPath)) ?? boards[0];
		if (board) open(board);
		else new Notice(STRINGS.notices.boardMissing(this.settings.boardPath));
	}

	/**
	 * Creates an Action and opens it. Without a status or Matter it lands in the backlog of the Inbox.
	 * Quick add will take over this entry point.
	 */
	async newAction(init: { statusId?: string; matterPath?: string; typeId?: string } = {}): Promise<void> {
		const s = this.settings;
		const statusId = init.statusId ?? backlogStatus(s.statuses)?.id ?? s.statuses[0]?.id ?? '';
		const typeId = init.typeId ?? defaultType(s.types)?.id ?? s.types[0]?.id ?? '';
		try {
			const file = await createAction(this.app, s, {
				title: STRINGS.untitledAction,
				statusId,
				typeId,
				matterPath: init.matterPath ?? s.inboxPath,
			});
			this.selection.set(file.path);
			await this.app.workspace.getLeaf('tab').openFile(file);
		} catch (e) {
			new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
		}
	}

	newMatter(): void {
		new NewMatterModal(this.app, async (result) => {
			try {
				await createMatter(this.app, this.settings, result);
			} catch (e) {
				new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
			}
		}).open();
	}

	/** Opens a Matter. The Matter overview will take over this entry point. */
	async openMatter(path: string): Promise<void> {
		const file = this.app.vault.getFileByPath(normalizePath(path));
		if (file) await this.app.workspace.getLeaf('tab').openFile(file);
	}
}
