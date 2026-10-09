import { Events, FileView, normalizePath, Notice, Plugin, TFile, TFolder } from 'obsidian';
import type { MattersSettings } from './settings';
import { STRINGS } from './strings';
import { CURRENT_SCHEMA, migrateSettings } from './services/migrations';
import { doneStatus } from './model/workflow';
import { registerCommands } from './commands';
import { Selection } from './selection';
import { MattersSettingTab } from './ui/settingsTab';
import { BoardPicker } from './ui/modals/boardPicker';
import { NewMatterModal } from './ui/modals/newMatterModal';
import { ProcessInboxModal } from './ui/modals/processInbox/processInboxModal';
import { QuickAddModal, type QuickAddInit } from './ui/modals/quickAdd/quickAddModal';
import { registerCollectionViews } from './views/bases/registerViews';
import { SetupView, VIEW_SETUP } from './views/setup/setupView';
import { InspectorView, VIEW_INSPECTOR } from './views/inspector/inspectorView';
import { MatterOverviewView, VIEW_MATTER_OVERVIEW } from './views/matter-overview/overviewView';
import { ensureDateTimeTypes } from './vault/internal';
import { frontmatterOf } from './vault/notes';
import { editAction } from './vault/actionWrites';
import { effectiveAction } from './services/effective';
import { resolverFor } from './vault/index';
import { createMatter } from './vault/matterWrites';
import { Watchers } from './vault/watchers';
import { pathSettingsAfterRename } from './services/renames';
import { NoteDecorations } from './views/notes/noteDecorations';

export default class MattersPlugin extends Plugin {
	settings!: MattersSettings;
	/** "settings-changed" fires after every save and after settings arrive from sync (then with `true`). */
	events = new Events();
	selection = new Selection();
	basesAvailable = false;
	private watchers: Watchers | null = null;
	private ribbonEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_SETUP, (leaf) => new SetupView(leaf, this));
		this.registerView(VIEW_INSPECTOR, (leaf) => new InspectorView(leaf, this));
		this.registerView(VIEW_MATTER_OVERVIEW, (leaf) => new MatterOverviewView(leaf, this));
		this.basesAvailable = registerCollectionViews(this);
		registerCommands(this);
		this.addSettingTab(new MattersSettingTab(this.app, this));
		this.ribbonEl = this.addRibbonIcon('square-kanban', STRINGS.ribbon, () => void this.openBoard());
		this.ribbonEl.addClass('mtm-ribbon');

		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => void this.onRename(file.path, oldPath)));
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file.path === this.selection.path) this.selection.set(null);
			}),
		);
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
		new NoteDecorations(this).start();
	}

	async loadSettings() {
		const saved: unknown = await this.loadData();
		this.settings = migrateSettings(saved);
		// Store a migration at once, so data.json says which schema it holds.
		const version = typeof saved === 'object' && saved !== null ? (saved as { schemaVersion?: unknown }).schemaVersion : undefined;
		if (typeof version === 'number' && version < CURRENT_SCHEMA) await this.saveData(this.settings);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.events.trigger('settings-changed');
	}

	async onExternalSettingsChange() {
		await this.loadSettings();
		this.events.trigger('settings-changed', true);
		// Setup finished on another device: start what runs once setup is done (it starts only once).
		if (this.settings.setupDone && this.app.workspace.layoutReady) this.onSetupDone();
	}

	/** The Inbox, the board and the folders are identified by their paths; follow renames, folders included. */
	private async onRename(path: string, oldPath: string): Promise<void> {
		const next = pathSettingsAfterRename(this.settings, oldPath, path);
		if (!next) return;
		Object.assign(this.settings, next);
		await this.saveSettings();
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

	/** Whether a board (`boardPath` or any base in the boards folder) is open in some tab. */
	isBoardOpen(): boolean {
		const folder = normalizePath(this.settings.folders.boards) + '/';
		const board = normalizePath(this.settings.boardPath);
		return this.app.workspace.getLeavesOfType('bases').some((leaf) => {
			const path = leaf.view instanceof FileView ? leaf.view.file?.path : undefined;
			return !!path && (path === board || path.startsWith(folder));
		});
	}

	/** Opens the board file, or a picker when the boards folder holds several. */
	async openBoard(): Promise<void> {
		const { vault, workspace } = this.app;
		const folder = vault.getAbstractFileByPath(normalizePath(this.settings.folders.boards));
		const boards =
			folder instanceof TFolder ? folder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'base') : [];
		// A board already open is brought forward; otherwise it opens in a new tab, never over the note being read.
		const open = (file: TFile) => {
			const existing = workspace.getLeavesOfType('bases').find((leaf) => leaf.view instanceof FileView && leaf.view.file?.path === file.path);
			if (existing) {
				void workspace.revealLeaf(existing);
				workspace.setActiveLeaf(existing, { focus: true });
				return;
			}
			const active = workspace.getMostRecentLeaf();
			const leaf = active && active.view.getViewType() === 'empty' ? active : workspace.getLeaf('tab');
			void leaf.openFile(file);
		};

		if (boards.length > 1) {
			new BoardPicker(this.app, boards, open).open();
			return;
		}
		const board = vault.getFileByPath(normalizePath(this.settings.boardPath)) ?? boards[0];
		if (board) open(board);
		else new Notice(STRINGS.notices.boardMissing(this.settings.boardPath));
	}

	/** Opens quick add; from a board cell it starts in that lane's Matter and that column's status. */
	quickAdd(init: QuickAddInit = {}): void {
		if (!this.settings.setupDone) return;
		new QuickAddModal(this, init).open();
	}

	/** Steps through the Inbox's open Actions; from a board focused on one Sphere, new Matters start in it. */
	processInbox(sphereId: string | null = null): void {
		if (!this.settings.setupDone) return;
		new ProcessInboxModal(this, { sphereId }).open();
	}

	/** The New Matter dialog; from a board focused on one Sphere it starts in that Sphere. */
	newMatter(sphereId: string | null = null): void {
		new NewMatterModal(
			this.app,
			async (result) => {
				try {
					await createMatter(this.app, this.settings, result);
				} catch (e) {
					new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
				}
			},
			'',
			{ spheres: this.settings.spheres, sphereId },
		).open();
	}

	/** Selects an Action and shows it in the inspector, opening the inspector if needed. */
	async selectAction(path: string): Promise<void> {
		this.selection.set(path);
		await this.app.workspace.ensureSideLeaf(VIEW_INSPECTOR, 'right', { active: false, reveal: true });
	}

	private isAction(file: TFile | null): file is TFile {
		return !!file && frontmatterOf(this.app, file)?.['mtm-kind'] === 'action';
	}

	/** The note in the active editor if it is an Action, otherwise the Action selected in the inspector. */
	currentAction(): TFile | null {
		const active = this.app.workspace.activeEditor?.file ?? null;
		if (this.isAction(active)) return active;
		const selected = this.selection.path ? this.app.vault.getFileByPath(this.selection.path) : null;
		return this.isAction(selected) ? selected : null;
	}

	isClosed(file: TFile): boolean {
		return effectiveAction(frontmatterOf(this.app, file), this.settings, resolverFor(this.app, file.path)).category === 'closed';
	}

	async markDone(file: TFile): Promise<void> {
		const done = doneStatus(this.settings.statuses);
		if (!done) return;
		try {
			await editAction(this.app, file, this.settings, { statusId: done.id });
		} catch (e) {
			new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
		}
	}

	/** Opens a Matter's overview, reusing a tab that already shows it. */
	async openMatter(path: string): Promise<void> {
		const { workspace, vault } = this.app;
		if (!vault.getFileByPath(normalizePath(path))) {
			new Notice(STRINGS.overview.missing);
			return;
		}
		// A background tab may not be loaded yet (no view), so match on its saved state too.
		const existing = workspace.getLeavesOfType(VIEW_MATTER_OVERVIEW).find((leaf) => {
			if (leaf.view instanceof MatterOverviewView && leaf.view.path === path) return true;
			const state = leaf.getViewState().state as { matter?: unknown } | undefined;
			return state?.matter === path;
		});
		if (existing) {
			await workspace.revealLeaf(existing);
			workspace.setActiveLeaf(existing, { focus: true });
			return;
		}
		const leaf = workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_MATTER_OVERVIEW, state: { matter: path }, active: true });
		await workspace.revealLeaf(leaf);
	}

	isMatter(file: TFile | null): file is TFile {
		return !!file && (file.path === this.settings.inboxPath || frontmatterOf(this.app, file)?.['mtm-kind'] === 'matter');
	}

	/** The Matter note in the active editor, otherwise the Matter of the active overview. */
	currentMatter(): TFile | null {
		const active = this.app.workspace.activeEditor?.file ?? null;
		if (this.isMatter(active)) return active;
		const view = this.app.workspace.getActiveViewOfType(MatterOverviewView);
		const file = view?.path ? this.app.vault.getFileByPath(view.path) : null;
		return this.isMatter(file) ? file : null;
	}
}
