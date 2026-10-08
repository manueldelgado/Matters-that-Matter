// Action, Matter and person notes outside the views: classes and a banner on open notes, classes on file explorer entries.
// Obsidian has no API for either; the banner goes after the inline title (reading view and editor), and explorer
// entries come from `vault/internal.ts`. Both degrade to nothing if the DOM changes.

import { debounce, Keymap, MarkdownView, Notice, TFile } from 'obsidian';
import type MattersPlugin from '../../main';
import { STRINGS } from '../../strings';
import { waitAge } from '../../model/actions';
import { toYmd } from '../../model/dates';
import { backlogStatus } from '../../model/workflow';
import type { ActionItem } from '../../services/actionItems';
import { actionNoteClasses, bannerDate, DECOR_PREFIXES, explorerClasses } from '../../services/noteDecor';
import { overviewModel, reviewState } from '../../services/overviewModel';
import { swapClasses } from '../../ui/components/dom';
import { showNoNextActionMenu, showStatusMenu, showTypeMenu } from '../../ui/components/menus';
import { lacksNextAction, nextStepStatus } from '../../services/nextAction';
import { dismissOrphan, moveAction } from '../../vault/actionWrites';
import { setMatterState } from '../../vault/matterWrites';
import { actionItem, allActionItems, linkedFile, matterInfo, peopleIndex } from '../../vault/index';
import { explorerTitleEls } from '../../vault/internal';
import { frontmatterOf, notesOfKind } from '../../vault/notes';
import { BANNER_ATTR, renderActionBanner, renderMatterBanner } from './noteBanner';
import { renderPersonBanner } from './personBanner';
import { personModel, personToken, type PersonEntry } from '../../services/personModel';

/** Vault changes come in bursts (a move writes several notes); decorate once they settle. */
const REFRESH_DELAY = 150;

export class NoteDecorations {
	private signatures = new WeakMap<MarkdownView, string>();
	/** Explorer entries that carry Action classes. */
	private decorated = new Set<string>();
	private refreshNotesSoon = debounce(() => this.refreshNotes(false), REFRESH_DELAY, true);
	private refreshExplorerSoon = debounce(() => this.refreshExplorer(), REFRESH_DELAY * 2, true);

	constructor(private plugin: MattersPlugin) {}

	/** Called once the layout is ready and setup is done. */
	start(): void {
		const { app } = this.plugin;
		this.plugin.registerEvent(
			app.workspace.on('layout-change', () => {
				this.refreshNotesSoon();
				// The explorer may have been opened again, with new entries.
				this.refreshExplorerSoon();
			}),
		);
		this.plugin.registerEvent(app.workspace.on('file-open', () => this.refreshNotesSoon()));
		this.plugin.registerEvent(this.plugin.selection.on('changed', () => this.markSelection()));
		this.plugin.registerEvent(
			app.metadataCache.on('changed', (file) => {
				this.decorateEntry(file);
				this.refreshNotesSoon();
			}),
		);
		this.plugin.registerEvent(
			app.vault.on('rename', (file, oldPath) => {
				this.decorated.delete(oldPath);
				if (file instanceof TFile) this.decorateEntry(file);
				this.refreshNotesSoon();
			}),
		);
		this.plugin.registerEvent(app.vault.on('delete', (file) => this.decorated.delete(file.path)));
		this.plugin.registerEvent(
			this.plugin.events.on('settings-changed', () => {
				this.refreshExplorer();
				this.refreshNotes(true);
			}),
		);
		// Today and overdue change with the clock.
		this.plugin.registerInterval(window.setInterval(() => this.refreshNotes(false), 60_000));
		this.plugin.register(() => this.clear());
		this.refreshExplorer();
		this.refreshNotes(true);
	}

	private clear(): void {
		for (const path of this.decorated) for (const el of explorerTitleEls(this.plugin.app, path)) swapClasses(el, DECOR_PREFIXES, []);
		this.decorated.clear();
		for (const view of this.markdownViews()) this.strip(view);
	}

	// ——— File explorer ———

	private refreshExplorer(): void {
		const actions = new Set(notesOfKind(this.plugin.app, 'action'));
		for (const path of [...this.decorated]) {
			const file = this.plugin.app.vault.getFileByPath(path);
			if (!file || !actions.has(file)) this.undecorateEntry(path);
		}
		for (const file of actions) this.decorateEntry(file);
	}

	private decorateEntry(file: TFile): void {
		const { app, settings } = this.plugin;
		// Right after a write the cache is briefly empty; the "changed" event follows.
		if (!app.metadataCache.getFileCache(file)) return;
		if (frontmatterOf(app, file)?.['mtm-kind'] !== 'action') {
			if (this.decorated.has(file.path)) this.undecorateEntry(file.path);
			return;
		}
		const classes = explorerClasses(actionItem(app, file, settings));
		for (const el of explorerTitleEls(app, file.path)) swapClasses(el, DECOR_PREFIXES, classes);
		this.decorated.add(file.path);
	}

	private undecorateEntry(path: string): void {
		for (const el of explorerTitleEls(this.plugin.app, path)) swapClasses(el, DECOR_PREFIXES, []);
		this.decorated.delete(path);
	}

	// ——— Open notes ———

	private markdownViews(): MarkdownView[] {
		return this.plugin.app.workspace
			.getLeavesOfType('markdown')
			.map((leaf) => leaf.view)
			.filter((view): view is MarkdownView => view instanceof MarkdownView);
	}

	private refreshNotes(force: boolean): void {
		const now = new Date();
		// Built at most once per refresh, and only when some open note is neither an Action nor a Matter.
		let people: Map<string, PersonEntry[]> | null = null;
		const peopleNow = () => (people ??= peopleIndex(this.plugin.app, this.plugin.settings));
		for (const view of this.markdownViews()) {
			try {
				this.decorateView(view, now, force, peopleNow);
			} catch (e) {
				console.error('Matters that Matter: could not decorate a note', e);
			}
		}
	}

	private strip(view: MarkdownView): void {
		swapClasses(view.contentEl, DECOR_PREFIXES, []);
		view.contentEl.querySelectorAll(`[${BANNER_ATTR}]`).forEach((el) => el.remove());
		this.signatures.delete(view);
	}

	private decorateView(view: MarkdownView, now: Date, force: boolean, people: () => Map<string, PersonEntry[]>): void {
		const { app } = this.plugin;
		const file = view.file;
		if (file && !app.metadataCache.getFileCache(file)) return;
		if (!file) {
			if (this.signatures.has(view)) this.strip(view);
			return;
		}
		// isMatter narrows its argument, so its result is kept in a plain boolean.
		const isMatter: boolean = this.plugin.isMatter(file);
		const entries = !isMatter && frontmatterOf(app, file)?.['mtm-kind'] !== 'action' ? people().get(file.path) : undefined;
		if (frontmatterOf(app, file)?.['mtm-kind'] === 'action') this.decorateAction(view, file, now, force);
		else if (isMatter) this.decorateMatter(view, file, now, force);
		else if (entries) this.decoratePerson(view, file, entries, now, force);
		else if (this.signatures.has(view)) this.strip(view);
	}

	/** Re-renders only when what the banner shows changed, or when Obsidian dropped the banner. */
	private unchanged(view: MarkdownView, signature: string, force: boolean): boolean {
		if (force || this.signatures.get(view) !== signature) return false;
		const present = view.contentEl.querySelectorAll(`[${BANNER_ATTR}]:is(.mtm-note-banner, .mtm-person-banner)`).length;
		return present === anchors(view.contentEl).length;
	}

	private place(view: MarkdownView, classes: string[], build: () => HTMLElement[]): void {
		swapClasses(view.contentEl, DECOR_PREFIXES, classes);
		view.contentEl.querySelectorAll(`[${BANNER_ATTR}]`).forEach((el) => el.remove());
		for (const anchor of anchors(view.contentEl)) {
			const els = build();
			if (anchor.after) anchor.el.after(...els);
			else anchor.el.prepend(...els);
		}
	}

	private decorateAction(view: MarkdownView, file: TFile, now: Date, force: boolean): void {
		const { app, settings } = this.plugin;
		const today = toYmd(now);
		const item = actionItem(app, file, settings);
		const matterFile = app.vault.getFileByPath(item.effective.matterPath);
		const matter = matterFile
			? matterInfo(app, matterFile, settings, today)
			: { name: item.effective.matterPath.split('/').pop()?.replace(/\.md$/i, '') ?? '', icon: 'inbox' };
		const waitingFile = item.waitingOn ? linkedFile(app, frontmatterOf(app, file)?.['mtm-waiting-on'], file.path) : null;
		const waitingOn = item.waitingOn ? (waitingFile?.basename ?? item.waitingOn.split('/').pop() ?? item.waitingOn) : null;
		const date = bannerDate(item, now, today);
		const classes = actionNoteClasses(item, now);

		const waitAgeNow = item.waitingSince ? waitAge(item.waitingSince, today) : null;
		const signature = JSON.stringify([file.path, classes, item.effective, item.priority, date, waitingOn, waitAgeNow, matter.name, matter.icon]);
		if (this.unchanged(view, signature, force)) return;
		this.signatures.set(view, signature);

		this.place(view, classes, () =>
			renderActionBanner(
				{ item, matter: { name: matter.name, icon: matter.icon }, date, waitingOn, waitAge: waitAgeNow },
				{
					typeMenu: (anchor) => showTypeMenu(anchor, settings.types, item.effective.type.id, (typeId) => this.write(file, { typeId })),
					statusMenu: (anchor) =>
						showStatusMenu(anchor, settings.statuses, { statusId: item.effective.status.id, category: item.category }, (statusId) =>
							this.write(file, { statusId }),
						),
					openMatter: (e) => this.openMatter(file, item, e),
					toggleDone: () => this.toggleDone(file, item),
					dismiss: () => void this.run(() => dismissOrphan(app, file, settings)),
				},
			),
		);
	}

	private decorateMatter(view: MarkdownView, file: TFile, now: Date, force: boolean): void {
		const { app, settings } = this.plugin;
		const today = toYmd(now);
		const matter = matterInfo(app, file, settings, today);
		const items = allActionItems(app, settings).filter((i) => i.effective.matterPath === file.path);
		const { stats } = overviewModel(items, settings.statuses, now, today, false);
		const o = STRINGS.overview;
		let review = null;
		if (matter.review?.cadence) {
			const { state, daysLate } = reviewState(matter.review, today);
			const label = state === 'ontime' ? o.reviewedAgo(matter.review.daysSince ?? 0) : state === 'overdue' ? o.reviewLate(daysLate) : o.notReviewed;
			review = { state, label };
		}

		const sphere = settings.spheres.find((x) => x.id === matter.sphere)?.label ?? null;
		const noNextAction = lacksNextAction(matter, items);
		const signature = JSON.stringify([file.path, matter, stats, review, sphere, noNextAction]);
		if (this.unchanged(view, signature, force)) return;
		this.signatures.set(view, signature);

		this.place(view, ['mtm-matter-note'], () => [
			renderMatterBanner(
				{ matter, sphere, stats, review, noNextAction },
				{
					openOverview: () => void this.plugin.openMatter(file.path),
					noNextActionMenu: (anchor) =>
						showNoNextActionMenu(anchor, {
							matterName: matter.name,
							newAction: () => this.plugin.quickAdd({ matterPath: file.path, statusId: nextStepStatus(settings.statuses)?.id }),
							markDormant: () => void setMatterState(app, file, 'dormant'),
							openOverview: () => void this.plugin.openMatter(file.path),
						}),
				},
			),
		]);
	}

	/** Any note an Action names as a person: what's open with them. No properties are written. */
	private decoratePerson(view: MarkdownView, file: TFile, entries: readonly PersonEntry[], now: Date, force: boolean): void {
		const { app, settings } = this.plugin;
		const today = toYmd(now);
		const model = personModel(entries, now);
		const matters = new Map<string, { name: string; icon: string }>();
		const matterOf = (path: string) => {
			let m = matters.get(path);
			if (!m) {
				const matterFile = app.vault.getFileByPath(path);
				const info = matterFile ? matterInfo(app, matterFile, settings, today) : null;
				m = { name: info?.name ?? path.split('/').pop()?.replace(/\.md$/i, '') ?? path, icon: info?.icon ?? 'inbox' };
				matters.set(path, m);
			}
			return m;
		};
		const cards = [...model.waiting, ...model.withThem];
		const signature = JSON.stringify([
			file.path,
			file.basename,
			today,
			model.done,
			model.lastDone,
			model.late,
			model.waiting.map((i) => i.path),
			cards.map((i) => [i.path, i.title, i.effective, i.priority, i.due, i.waitingOn, i.waitingSince, i.linkedCount, matterOf(i.effective.matterPath)]),
		]);
		if (this.unchanged(view, signature, force)) return;
		this.signatures.set(view, signature);

		this.place(view, [], () => [
			renderPersonBanner(
				{ name: file.basename, model, matterOf, selected: this.plugin.selection.path, now },
				{
					newAction: () => this.plugin.quickAdd({ text: personToken(file.basename) }),
					select: (path) => void this.plugin.selectAction(path),
					open: (path, e) => {
						const target = app.vault.getFileByPath(path);
						if (!target) return;
						this.plugin.selection.set(path);
						void app.workspace.getLeaf(Keymap.isModEvent(e) || 'tab').openFile(target);
					},
					dismiss: (item) => {
						const target = app.vault.getFileByPath(item.path);
						if (target) void this.run(() => dismissOrphan(app, target, settings));
					},
				},
			),
		]);
	}

	/** Cards in banners follow the selection, like the views'. */
	private markSelection(): void {
		const selected = this.plugin.selection.path;
		for (const view of this.markdownViews()) {
			view.contentEl.querySelectorAll<HTMLElement>(`[${BANNER_ATTR}] [data-path]`).forEach((el) => el.toggleClass('is-selected', el.dataset.path === selected));
		}
	}

	// ——— Handlers ———

	private async run(fn: () => Promise<void>): Promise<void> {
		try {
			await fn();
		} catch (e) {
			console.error('Matters that Matter: write failed', e);
			new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
		}
	}

	private write(file: TFile, target: { statusId?: string; typeId?: string }): void {
		void this.run(() => moveAction(this.plugin.app, file, target, this.plugin.settings));
	}

	private toggleDone(file: TFile, item: ActionItem): void {
		if (item.category !== 'closed') {
			void this.plugin.markDone(file);
			return;
		}
		const backlog = backlogStatus(this.plugin.settings.statuses);
		if (backlog) this.write(file, { statusId: backlog.id });
	}

	/** The Matter's overview; Ctrl/Cmd-click opens its note instead. */
	private openMatter(file: TFile, item: ActionItem, e: MouseEvent | KeyboardEvent): void {
		const path = item.effective.matterPath;
		if (e.instanceOf(MouseEvent) && Keymap.isModEvent(e)) {
			const target = this.plugin.app.vault.getFileByPath(path);
			if (target) void this.plugin.app.workspace.getLeaf(Keymap.isModEvent(e)).openFile(target);
			return;
		}
		void this.plugin.openMatter(path);
	}
}

/**
 * Where banners go: after the inline title of the reading view and of the editor, or at the top of the sizer
 * when there is no inline title element.
 */
function anchors(contentEl: HTMLElement): { el: HTMLElement; after: boolean }[] {
	const out: { el: HTMLElement; after: boolean }[] = [];
	contentEl.querySelectorAll<HTMLElement>('.markdown-preview-sizer, .cm-sizer').forEach((sizer) => {
		const title = sizer.querySelector<HTMLElement>('.inline-title');
		out.push(title ? { el: title, after: true } : { el: sizer, after: false });
	});
	return out;
}
