import { Events, normalizePath, Notice, Plugin, TFile, TFolder } from 'obsidian';
import type { MattersSettings } from './settings';
import { STRINGS } from './strings';
import { migrateSettings } from './services/migrations';
import { registerCommands } from './commands';
import { MattersSettingTab } from './ui/settingsTab';
import { BoardPicker } from './ui/modals/boardPicker';
import { registerCollectionViews } from './views/bases/registerViews';
import { SetupView, VIEW_SETUP } from './views/setup/setupView';
import { ensureDateTimeTypes } from './vault/internal';

export default class MattersPlugin extends Plugin {
	settings!: MattersSettings;
	/** "settings-changed" fires after every save and after settings arrive from sync. */
	events = new Events();
	basesAvailable = false;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_SETUP, (leaf) => new SetupView(leaf, this));
		this.basesAvailable = registerCollectionViews(this);
		registerCommands(this);
		this.addSettingTab(new MattersSettingTab(this.app, this));
		this.addRibbonIcon('square-kanban', STRINGS.ribbon, () => void this.openBoard()).addClass('mtm-ribbon');

		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => void this.onRename(file.path, oldPath)));
		this.app.workspace.onLayoutReady(() => this.onLayoutReady());
	}

	private onLayoutReady(): void {
		if (!this.settings.setupDone) {
			void this.openSetup();
			return;
		}
		ensureDateTimeTypes(this.app);
		if (!this.basesAvailable) new Notice(STRINGS.notices.basesDisabled);
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
}
