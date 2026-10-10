// "What matters today?" in new tabs: a panel added to Obsidian's empty view.
// Obsidian has no API for the empty tab, so this is isolated and guarded like the note banners: it finds the
// view's `.empty-state`, adds the panel and a class (the plugin's CSS hides Obsidian's own heading and actions),
// re-renders only when what it shows changes, and removes everything on unload or when the setting turns it off.

import { debounce, Keymap, Notice, type WorkspaceLeaf } from 'obsidian';
import type MattersPlugin from '../../main';
import { STRINGS } from '../../strings';
import { toYmd } from '../../model/dates';
import { todayModel, type TodayModel } from '../../services/todayModel';
import { allActionItems, allMatters } from '../../vault/index';
import { dismissOrphan } from '../../vault/actionWrites';
import { WaitingPicker } from '../../ui/modals/todayPickers';
import { runCommand } from '../../vault/internal';
import { renderToday } from './todayRender';

const HAS_TODAY = 'mtm-has-today';
/** Re-checked every minute: the date rolls over and timed Actions fall late. */
const TICK = 60_000;

export class TodayPanels {
	/** What each empty view shows, so unchanged data skips the render. */
	private signatures = new WeakMap<HTMLElement, string>();
	/** Every empty view showing the panel, in any window. */
	private decorated = new Set<HTMLElement>();
	private refreshSoon = debounce(() => this.refresh(), 250, true);

	constructor(private plugin: MattersPlugin) {}

	start(): void {
		const { app } = this.plugin;
		const soon = () => this.refreshSoon();
		this.plugin.registerEvent(app.workspace.on('layout-change', soon));
		this.plugin.registerEvent(app.workspace.on('active-leaf-change', soon));
		this.plugin.registerEvent(app.metadataCache.on('changed', soon));
		this.plugin.registerEvent(app.vault.on('delete', soon));
		this.plugin.registerEvent(app.vault.on('rename', soon));
		this.plugin.registerEvent(this.plugin.events.on('settings-changed', soon));
		this.plugin.registerEvent(this.plugin.selection.on('changed', soon));
		this.plugin.registerInterval(window.setInterval(soon, TICK));
		this.plugin.register(() => this.removeAll());
		app.workspace.onLayoutReady(soon);
	}

	refresh(): void {
		try {
			this.render();
		} catch (e) {
			console.warn('Matters that Matter: could not show Today in a new tab', e);
		}
	}

	private render(): void {
		const { app, settings } = this.plugin;
		const roots: WorkspaceLeaf[] = [];
		app.workspace.iterateRootLeaves((leaf) => void roots.push(leaf));
		const mode = settings.todayInNewTabs;
		const show = settings.setupDone && (mode === 'every' || (mode === 'alone' && roots.length === 1));
		const targets = show ? roots.filter((leaf) => !leaf.isDeferred && leaf.view.getViewType() === 'empty') : [];
		const states = new Map<HTMLElement, WorkspaceLeaf>();
		for (const leaf of targets) {
			const state = leaf.view.containerEl.querySelector('.empty-state');
			if (state?.instanceOf(HTMLElement)) states.set(state, leaf);
		}

		// Panels that should no longer show.
		for (const state of [...this.decorated]) if (!states.has(state) || !state.isConnected) this.remove(state);
		if (!states.size) return;

		const now = new Date();
		const today = toYmd(now);
		const items = allActionItems(app, settings);
		const matters = allMatters(app, settings, today);
		const model = todayModel({ items, matters, statuses: settings.statuses, inboxPath: settings.inboxPath, now });
		const byPath = new Map(matters.map((m) => [m.path, m]));
		const matterOf = (path: string) => {
			const m = byPath.get(path);
			return { name: m?.name ?? path.split('/').pop()?.replace(/\.md$/i, '') ?? path, icon: m?.icon ?? 'circle-dot' };
		};
		const signature = this.signature(model, now, this.plugin.selection.path);

		for (const [state, leaf] of states) {
			if (state.hasClass(HAS_TODAY) && this.signatures.get(state) === signature && state.querySelector(':scope > .mtm-today')) continue;
			state.querySelector(':scope > .mtm-today')?.remove();
			state.addClass(HAS_TODAY);
			this.decorated.add(state);
			this.signatures.set(state, signature);
			renderToday(
				state,
				{ model, now, types: settings.types, selected: this.plugin.selection.path, matterOf },
				{
					quickAdd: () => this.plugin.quickAdd(),
					openBoard: () => void this.plugin.openBoard(),
					newNote: () => this.command(leaf, 'file-explorer:new-file'),
					goToFile: () => this.command(leaf, 'switcher:open'),
					processInbox: () => this.plugin.processInbox(),
					pickReview: () => this.plugin.reviewMatters(),
					pickWaiting: () => {
						if (!model.waiting.length) new Notice(STRINGS.today.noWaiting);
						else new WaitingPicker(app, model.waiting, now, (i) => void this.plugin.selectAction(i.path)).open();
					},
					select: (path) => void this.plugin.selectAction(path),
					open: (path, e) => {
						const file = app.vault.getFileByPath(path);
						if (!file) return;
						this.plugin.selection.set(path);
						// In this tab; Ctrl/Cmd-click opens a new one.
						void (Keymap.isModEvent(e) ? app.workspace.getLeaf(Keymap.isModEvent(e)) : leaf).openFile(file);
					},
					dismiss: (item) => {
						const file = app.vault.getFileByPath(item.path);
						if (file) void dismissOrphan(app, file, settings).catch((err: unknown) => new Notice(STRINGS.notices.writeFailed(err instanceof Error ? err.message : String(err))));
					},
				},
			);
		}
	}

	/** Runs one of Obsidian's commands as if from this tab (so a new note opens here). */
	private command(leaf: WorkspaceLeaf, id: string): void {
		this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
		runCommand(this.plugin.app, id);
	}

	/** What the panel shows, compactly: Actions by path and state, the counts, the day and the selection. */
	private signature(model: TodayModel, now: Date, selected: string | null): string {
		const card = (i: { path: string; title: string; due: unknown; priority: unknown; effective: { status: { id: string }; type: { id: string; icon: string; tone: string }; matterPath: string } }) =>
			[i.path, i.title, JSON.stringify(i.due), i.priority, i.effective.status.id, i.effective.type.id, i.effective.type.icon, i.effective.type.tone, i.effective.matterPath].join('|');
		// The minute only matters while something timed is due today (it can fall late).
		const today = toYmd(now);
		const timed = model.due.some((i) => i.due?.time && i.due.date === today);
		return [
			today,
			timed ? `${now.getHours()}:${now.getMinutes()}` : '',
			selected ?? '',
			model.inbox,
			model.reviews.map((m) => m.path).join(','),
			model.waiting.length,
			model.longWaits,
			model.due.map(card).join(';'),
			model.next.map(card).join(';'),
		].join('#');
	}

	private remove(state: HTMLElement): void {
		state.querySelector(':scope > .mtm-today')?.remove();
		state.removeClass(HAS_TODAY);
		this.signatures.delete(state);
		this.decorated.delete(state);
	}

	private removeAll(): void {
		for (const state of [...this.decorated]) this.remove(state);
	}
}
