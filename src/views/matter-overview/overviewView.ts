// The Matter overview: one Matter's about, review, stats and Actions, in a tab.

import { Component, debounce, ItemView, Keymap, MarkdownRenderer, normalizePath, Notice, type TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type MattersPlugin from '../../main';
import { STRINGS } from '../../strings';
import { toYmd } from '../../model/dates';
import type { Cadence, MatterState } from '../../model/matters';
import { overviewModel } from '../../services/overviewModel';
import { IconPickerModal } from '../../ui/modals/iconPickerModal';
import { dismissOrphan } from '../../vault/actionWrites';
import { allActionItems, backlinksTo, DEFAULT_MATTER_ICON, matterInfo, noteBody, peopleOf } from '../../vault/index';
import { markReviewed, setMatterIcon, setMatterState, setReviewCadence } from '../../vault/matterWrites';
import { refreshViewTitle } from '../../vault/internal';
import { frontmatterOf } from '../../vault/notes';
import { renderMissing, renderOverview, type OverviewHandlers } from './overviewRender';

export const VIEW_MATTER_OVERVIEW = 'mtm-matter-overview';

/** Vault changes come in bursts (a move writes several notes); render once they settle. */
const REFRESH_DELAY = 150;

export class MatterOverviewView extends ItemView {
	path: string | null = null;
	private showAllDone = false;
	private customCadence = false;
	private aboutComponent: Component | null = null;
	private renderToken = 0;
	/** A refresh skipped while the user was typing; it runs when focus leaves the field. */
	private deferred = false;
	private refreshSoon = debounce(() => void this.refresh(), REFRESH_DELAY, true);

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: MattersPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_MATTER_OVERVIEW;
	}

	getDisplayText(): string {
		return this.file()?.basename ?? STRINGS.overview.title;
	}

	getIcon(): string {
		const file = this.file();
		const icon = file ? frontmatterOf(this.app, file)?.['mtm-icon'] : undefined;
		return typeof icon === 'string' && icon.trim() ? icon.trim() : DEFAULT_MATTER_ICON;
	}

	// Not `file`: Obsidian reads a `file` key as a note to open and swaps in a Markdown view.
	getState(): Record<string, unknown> {
		return { matter: this.path };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const file = (state as { matter?: unknown } | null)?.matter;
		if (typeof file === 'string' && file !== this.path) {
			this.path = file;
			this.showAllDone = false;
			this.customCadence = false;
		}
		await super.setState(state, result);
		await this.refresh();
	}

	private file(): TFile | null {
		return this.path ? this.app.vault.getFileByPath(normalizePath(this.path)) : null;
	}

	async onOpen(): Promise<void> {
		const { app, plugin } = this;
		this.registerEvent(plugin.events.on('settings-changed', () => this.refreshSoon()));
		this.registerEvent(plugin.selection.on('changed', () => this.markSelection()));
		// Any Action may move in or out of this Matter; Matter notes carry names and icons.
		this.registerEvent(
			app.metadataCache.on('changed', (file) => {
				const kind = frontmatterOf(app, file)?.['mtm-kind'];
				if (file.path === this.path || kind === 'action' || kind === 'matter') this.refreshSoon();
			}),
		);
		this.registerEvent(app.metadataCache.on('resolved', () => this.refreshSoon()));
		this.registerEvent(
			app.vault.on('rename', (file, oldPath) => {
				if (oldPath !== this.path) {
					this.refreshSoon();
					return;
				}
				// Setting the state again updates the tab title.
				void this.leaf.setViewState({ ...this.leaf.getViewState(), state: { matter: file.path } });
			}),
		);
		this.registerEvent(app.vault.on('delete', () => this.refreshSoon()));
		this.registerDomEvent(this.contentEl, 'focusout', () => {
			window.setTimeout(() => {
				if (this.deferred && !this.isTyping()) this.refreshSoon();
			}, 0);
		});
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.refreshSoon.cancel();
		this.clearAbout();
	}

	/** Typing a custom cadence: a re-render would lose the number. */
	private isTyping(): boolean {
		const el = activeDocument.activeElement;
		return !!el?.instanceOf(HTMLInputElement) && this.contentEl.contains(el);
	}

	private clearAbout(): void {
		if (this.aboutComponent) this.removeChild(this.aboutComponent);
		this.aboutComponent = null;
	}

	private async refresh(): Promise<void> {
		const { app, plugin } = this;
		const settings = plugin.settings;
		const file = this.file();
		if (!file) {
			this.renderToken++;
			this.clearAbout();
			this.contentEl.empty();
			if (this.path) renderMissing(this.contentEl);
			return;
		}
		// Right after a write the cache is stale until the note is parsed again; its 'changed' event refreshes then.
		if (!app.metadataCache.getFileCache(file)) return;
		if (this.isTyping()) {
			this.deferred = true;
			return;
		}
		this.deferred = false;

		const token = ++this.renderToken;
		const now = new Date();
		const today = toYmd(now);
		const matter = matterInfo(app, file, settings, today);
		const items = allActionItems(app, settings).filter((i) => i.effective.matterPath === file.path);
		const body = matter.isInbox ? null : await noteBody(app, file);
		if (token !== this.renderToken) return;

		refreshViewTitle(this);
		const scroll = this.contentEl.querySelector('.mtm-scroll')?.scrollTop ?? 0;
		this.clearAbout();
		this.contentEl.empty();
		renderOverview(
			this.contentEl,
			{
				matter,
				file,
				rawCadence: frontmatterOf(app, file)?.['mtm-review-every'],
				body,
				model: overviewModel(items, settings.statuses, now, today, this.showAllDone),
				people: peopleOf(app, items.map((i) => i.path)),
				notes: backlinksTo(app, file),
				settings,
				now,
				today,
				selected: plugin.selection.path,
				showAllDone: this.showAllDone,
				customCadence: this.customCadence,
			},
			this.handlers,
		);
		const scrollEl = this.contentEl.querySelector('.mtm-scroll');
		if (scrollEl) scrollEl.scrollTop = scroll;
	}

	private markSelection(): void {
		const selected = this.plugin.selection.path;
		this.contentEl.querySelectorAll<HTMLElement>('.mtm-card[data-path]').forEach((el) => {
			el.toggleClass('is-selected', el.dataset.path === selected);
		});
	}

	private async write(fn: (file: TFile) => Promise<unknown>): Promise<void> {
		const file = this.file();
		if (!file) return;
		try {
			await fn(file);
		} catch (e) {
			console.error('Matters that Matter: write failed', e);
			new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
		}
	}

	private openLeaf(e: MouseEvent | KeyboardEvent) {
		return this.app.workspace.getLeaf(Keymap.isModEvent(e) || 'tab');
	}

	private handlers: OverviewHandlers = {
		changeIcon: () => {
			const file = this.file();
			if (!file) return;
			new IconPickerModal(this.app, this.getIcon(), (icon) => void this.write((f) => setMatterIcon(this.app, f, icon))).open();
		},
		showOnBoard: () => void this.plugin.openBoard(),
		newAction: () => {
			if (this.path) this.plugin.quickAdd({ matterPath: this.path });
		},
		openNote: (e) => {
			const file = this.file();
			if (file) void this.openLeaf(e).openFile(file);
		},
		renderAbout: (el, markdown) => {
			const component = new Component();
			this.aboutComponent = this.addChild(component);
			void MarkdownRenderer.render(this.app, markdown, el, this.path ?? '', component);
			// Links in the rendered note open like links in Obsidian.
			el.addEventListener('click', (e) => {
				const link = (e.target as HTMLElement).closest('a.internal-link');
				if (!link?.instanceOf(HTMLAnchorElement)) return;
				e.preventDefault();
				const target = link.dataset.href ?? link.getAttr('href') ?? '';
				void this.app.workspace.openLinkText(target, this.path ?? '', Keymap.isModEvent(e) || 'tab');
			});
		},
		setState: (state: MatterState) => void this.write((f) => setMatterState(this.app, f, state)),
		markReviewed: () => void this.write((f) => markReviewed(this.app, f)),
		setCadence: (cadence: Cadence | null) => {
			this.customCadence = false;
			void this.write((f) => setReviewCadence(this.app, f, cadence));
		},
		chooseCustom: () => {
			this.customCadence = true;
			void this.refresh();
		},
		select: (path) => void this.plugin.selectAction(path),
		open: (path, e) => {
			const file = this.app.vault.getFileByPath(path);
			if (file) void this.openLeaf(e).openFile(file);
		},
		dismiss: (item) => {
			const file = this.app.vault.getFileByPath(item.path);
			if (file) void dismissOrphan(this.app, file, this.plugin.settings).catch((e) => {
				new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
			});
		},
		toggleDone: () => {
			this.showAllDone = !this.showAllDone;
			void this.refresh();
		},
		openFile: (file, e) => void this.openLeaf(e).openFile(file),
	};
}
