// The inspector: the selected Action in the right sidebar.

import { debounce, ItemView, Keymap, Notice, Platform, TFile, type UserEvent, type WorkspaceLeaf } from 'obsidian';
import type MattersPlugin from '../../main';
import { STRINGS } from '../../strings';
import { backlogStatus, doneStatus } from '../../model/workflow';
import type { FieldEdit } from '../../services/actionEdit';
import { readActionDetails, type ActionDetails } from '../../vault/actionDetails';
import {
	addChecklistItem,
	dismissOrphan,
	editAction,
	renameAction,
	setChecklistItem,
	writeDetails,
	type ActionTarget,
} from '../../vault/actionWrites';
import { frontmatterOf, linkTo } from '../../vault/notes';
import { ConfirmModal } from '../../ui/modals/confirmModal';
import { PersonPicker } from '../../ui/modals/personPicker';
import { renderEmpty, renderInspector, type EmptyContext, type InspectorHandlers } from './inspectorRender';

export const VIEW_INSPECTOR = 'mtm-inspector';

/** Details are saved about a second after typing stops (and on blur, and when the view closes). */
const DETAILS_DELAY = 1000;

export class InspectorView extends ItemView {
	private file: TFile | null = null;
	private details: ActionDetails | null = null;
	private renderToken = 0;
	/** A refresh skipped while the user was typing; it runs when focus leaves the field. */
	private deferred = false;
	private pendingDetails: { file: TFile; text: string } | null = null;
	/** The details text last read from or written to the note, so a save replaces exactly that. */
	private detailsBase: { path: string; text: string } | null = null;
	/** The details write in flight; a refresh waits for it so it never shows the old text. */
	private detailsWrite: Promise<void> = Promise.resolve();
	private saveDetailsSoon = debounce(() => void this.flushDetails(), DETAILS_DELAY, true);

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: MattersPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_INSPECTOR;
	}

	getDisplayText(): string {
		return STRINGS.inspector.title;
	}

	getIcon(): string {
		return 'square-kanban';
	}

	async onOpen(): Promise<void> {
		const { app, plugin } = this;
		this.registerEvent(
			plugin.selection.on('changed', () => {
				void this.flushDetails();
				void this.refresh();
			}),
		);
		this.registerEvent(plugin.events.on('settings-changed', () => void this.refresh()));
		// The Action itself, its Matter's name and icon, and the Matter list all come from metadata.
		this.registerEvent(
			app.metadataCache.on('changed', (file) => {
				if (file.path === plugin.selection.path || frontmatterOf(app, file)?.['mtm-kind'] === 'matter') void this.refresh();
			}),
		);
		this.registerEvent(app.vault.on('rename', () => void this.refresh()));
		// The empty state offers "Open board" and "Hide sidebar" depending on the layout.
		this.registerEvent(app.workspace.on('layout-change', () => {
			if (!this.file) void this.refresh();
		}));
		// Deleting the selected Action clears the selection (see main.ts); other deletions may remove a linked note.
		this.registerEvent(app.vault.on('delete', () => void this.refresh()));
		this.registerDomEvent(this.contentEl, 'focusout', () => {
			// Wait for focus to land before deciding whether the user is still typing.
			window.setTimeout(() => {
				if (this.deferred && !this.isTyping()) void this.refresh();
			}, 0);
		});
		await this.refresh();
	}

	async onClose(): Promise<void> {
		await this.flushDetails();
	}

	/** Typing in a text field: a re-render now would lose the caret or an unsaved value. */
	private isTyping(): boolean {
		const el = activeDocument.activeElement;
		if (!el?.instanceOf(HTMLElement) || !this.contentEl.contains(el)) return false;
		if (el.isContentEditable) return true;
		if (!el.instanceOf(HTMLInputElement)) return false;
		// The "Add a step" field re-renders freely once its text has been added.
		if (el.closest('.mtm-check-add')) return el.value !== '';
		return ['text', 'date', 'time'].includes(el.type);
	}

	private async refresh(): Promise<void> {
		const { app, plugin } = this;
		const path = plugin.selection.path;
		const file = path ? app.vault.getFileByPath(path) : null;
		// Right after a write the cache is stale until the note is parsed again; its 'changed' event refreshes then.
		if (file && !app.metadataCache.getFileCache(file)) {
			this.renderToken++;
			return;
		}
		const isAction = !!file && frontmatterOf(app, file)?.['mtm-kind'] === 'action';

		if (!plugin.settings.setupDone || !file || !isAction) {
			this.renderToken++;
			this.file = null;
			this.details = null;
			this.deferred = false;
			this.contentEl.empty();
			renderEmpty(this.contentEl, this.emptyContext());
			return;
		}
		const sameFile = file === this.file;
		if (sameFile && this.isTyping()) {
			this.deferred = true;
			return;
		}
		this.deferred = false;
		this.file = file;

		const token = ++this.renderToken;
		await this.detailsWrite;
		const details = await readActionDetails(app, file, plugin.settings);
		if (token !== this.renderToken) return;
		this.details = details;
		this.detailsBase = { path: file.path, text: details.details };

		const scrollTop = sameFile ? this.contentEl.querySelector('.mtm-inspector-body')?.scrollTop ?? 0 : 0;
		const refocusStep = sameFile && activeDocument.activeElement?.closest('.mtm-check-add') !== null;
		this.contentEl.empty();
		renderInspector(this.contentEl, details, plugin.settings, this.handlers);
		const body = this.contentEl.querySelector('.mtm-inspector-body');
		if (body) body.scrollTop = scrollTop;
		if (refocusStep) this.contentEl.querySelector<HTMLInputElement>('.mtm-check-add input')?.focus();
	}

	private emptyContext(): EmptyContext {
		const { workspace } = this.app;
		const root = this.leaf.getRoot();
		const dock = root === workspace.rightSplit ? workspace.rightSplit : root === workspace.leftSplit ? workspace.leftSplit : null;
		return {
			types: this.plugin.settings.types,
			side: dock === workspace.rightSplit ? 'right' : dock ? 'left' : null,
			phone: Platform.isMobile,
			boardOpen: this.plugin.isBoardOpen(),
			openBoard: () => void this.plugin.openBoard(),
			hideSidebar: () => dock?.collapse(),
		};
	}

	// ——— Writes ———

	private async write(fn: (file: TFile) => Promise<unknown>): Promise<void> {
		const file = this.file;
		if (!file) return;
		try {
			await fn(file);
		} catch (e) {
			console.error('Matters that Matter: write failed', e);
			new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
		}
	}

	private edit(target: ActionTarget, fields?: FieldEdit): void {
		void this.write((file) => editAction(this.app, file, this.plugin.settings, target, fields));
	}

	private async flushDetails(): Promise<void> {
		this.saveDetailsSoon.cancel();
		const pending = this.pendingDetails;
		this.pendingDetails = null;
		if (!pending) return this.detailsWrite;
		const base = this.detailsBase?.path === pending.file.path ? this.detailsBase.text : undefined;
		this.detailsWrite = writeDetails(this.app, pending.file, pending.text, base)
			.then(() => {
				this.detailsBase = { path: pending.file.path, text: pending.text.trim() };
			})
			.catch((e) => {
				new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
			});
		return this.detailsWrite;
	}

	private pickPerson(exclude: (string | undefined)[], onPick: (person: TFile, file: TFile) => void): void {
		const file = this.file;
		if (!file) return;
		const paths = new Set(exclude.filter((p): p is string => !!p));
		new PersonPicker(this.app, this.plugin.settings.folders.people, paths, (person) => onPick(person, file)).open();
	}

	private openLeaf(e: UserEvent) {
		return this.app.workspace.getLeaf(Keymap.isModEvent(e) || 'tab');
	}

	private handlers: InspectorHandlers = {
		close: () => this.plugin.selection.set(null),
		openNote: (e) => {
			if (this.file) void this.openLeaf(e).openFile(this.file);
		},
		openMatter: (path) => void this.plugin.openMatter(path),
		openFile: (file, e) => void this.openLeaf(e).openFile(file),
		openPerson: (person, e) => {
			if (person.file) void this.openLeaf(e).openFile(person.file);
			else void this.app.workspace.openLinkText(person.linktext, this.file?.path ?? '', Keymap.isModEvent(e) || 'tab');
		},
		dismiss: () => void this.write((file) => dismissOrphan(this.app, file, this.plugin.settings)),
		rename: (title) =>
			void this.write(async (file) => {
				// Nothing to rename (empty or unchanged): show the current title again.
				if (!(await renameAction(this.app, file, title))) await this.refresh();
			}),
		setStatus: (statusId) => this.edit({ statusId }),
		setType: (typeId) => this.edit({ typeId }),
		setMatter: (matterPath) => this.edit({ matterPath }),
		setPriority: (priority) => this.edit({}, { priority }),
		setDate: (field, value) => this.edit({}, field === 'start' ? { start: value } : { due: value }),
		pickWaitingOn: () =>
			this.pickPerson([this.details?.waitingOn?.key], (person, file) =>
				this.edit({}, { waitingOn: { link: linkTo(this.app, person, file.path), key: person.path } }),
			),
		clearWaitingOn: () => this.edit({}, { waitingOn: null }),
		setWaitingSince: (day) => this.edit({}, { waitingSince: day }),
		addPerson: () =>
			this.pickPerson([this.details?.waitingOn?.key, ...(this.details?.people.map((p) => p.key) ?? [])], (person, file) =>
				this.edit({}, { addPerson: { link: linkTo(this.app, person, file.path), key: person.path } }),
			),
		removePerson: (key) => this.edit({}, { removePerson: key }),
		detailsInput: (text) => {
			if (!this.file) return;
			this.pendingDetails = { file: this.file, text };
			this.saveDetailsSoon();
		},
		detailsDone: () => void this.flushDetails(),
		toggleCheck: (item, checked) => void this.write((file) => setChecklistItem(this.app, file, item.line, item.text, checked)),
		addCheck: (text) => void this.write((file) => addChecklistItem(this.app, file, text)),
		delete: () => {
			const file = this.file;
			if (!file) return;
			const s = STRINGS.inspector;
			new ConfirmModal(this.app, {
				title: s.deleteTitle(file.basename),
				body: s.deleteBody,
				confirm: STRINGS.modals.delete,
				danger: true,
				onConfirm: async () => {
					this.pendingDetails = null;
					await this.app.fileManager.trashFile(file);
				},
			}).open();
		},
		markDone: () => {
			const done = doneStatus(this.plugin.settings.statuses);
			if (done) this.edit({ statusId: done.id });
		},
		reopen: () => {
			const backlog = backlogStatus(this.plugin.settings.statuses);
			if (backlog) this.edit({ statusId: backlog.id });
		},
	};
}
