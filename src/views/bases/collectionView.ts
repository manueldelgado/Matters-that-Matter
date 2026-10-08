// What the board, list, calendar and timeline share as custom Bases views: options from the view config,
// the type chips, Show done, the Actions in the Bases result, selection, and writes.

import { BasesView, debounce, Keymap, Notice, type QueryController, type TFile } from 'obsidian';
import type MattersPlugin from '../../main';
import { STRINGS } from '../../strings';
import { resolveInboxPosition, resolveShowDone } from '../../model/actions';
import type { InboxPosition } from '../../model/matters';
import type { ActionItem } from '../../services/actionItems';
import { dismissOrphan } from '../../vault/actionWrites';
import { actionItem } from '../../vault/index';
import { frontmatterOf } from '../../vault/notes';

/** Option keys stored in the .base view config. */
export const OPTION_KEYS = {
	inboxPosition: 'mtmInboxPosition',
	showDone: 'mtmShowDone',
	doneDays: 'mtmDoneDays',
	hideEmptyLanes: 'mtmHideEmptyLanes',
} as const;

/** Type chips switched off, kept in the view config (so a newly added type starts on). */
export const TYPES_OFF_KEY = 'mtmTypesOff';
const CONFIG_DELAY = 800;

export interface CollectionOptions {
	inboxPosition: InboxPosition;
	showDone: boolean;
	/** "Show done from the last N days"; null shows all closed Actions. */
	doneDays: number | null;
	/** Type IDs switched off in the toolbar. When every type is off, all show. */
	typesOff: ReadonlySet<string>;
}

export abstract class CollectionView extends BasesView {
	/** Bases provides data and config from the first onDataUpdated on. */
	protected ready = false;
	protected signature = '';
	/** Config values not yet written (null clears a key); they win over what the config says. */
	private pending = new Map<string, unknown>();
	private flushConfig = debounce(() => this.writeConfig(), CONFIG_DELAY, true);

	constructor(
		controller: QueryController,
		protected containerEl: HTMLElement,
		protected plugin: MattersPlugin,
	) {
		super(controller);
		this.registerEvent(plugin.events.on('settings-changed', () => this.refresh(true)));
		this.registerEvent(plugin.selection.on('changed', () => this.markSelection()));
		// Labels such as Today and overdue states change with the clock.
		this.registerInterval(window.setInterval(() => this.refresh(false), 60_000));
	}

	/** Re-renders when what the view shows has changed (always when forced). */
	protected abstract refresh(force: boolean): void;

	onDataUpdated(): void {
		this.ready = true;
		this.refresh(false);
	}

	onunload(): void {
		this.flushConfig.run();
	}

	// ——— View config ———

	protected configValue(key: string): unknown {
		return this.pending.has(key) ? this.pending.get(key) : this.config.get(key);
	}

	/** Stores a value soon (rapid toggles coalesce). Never written during a render: config.set() triggers onDataUpdated. */
	protected setConfigSoon(key: string, value: unknown): void {
		this.pending.set(key, value);
		this.flushConfig();
	}

	private writeConfig(): void {
		for (const [key, value] of this.pending) this.config.set(key, value);
		this.pending.clear();
	}

	protected typesOff(): string[] {
		const raw = this.configValue(TYPES_OFF_KEY);
		return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
	}

	/** View options fall back to their declared defaults: config.get() returns nothing until changed. */
	protected collectionOptions(): CollectionOptions {
		const s = this.plugin.settings;
		const days = Number(this.config.get(OPTION_KEYS.doneDays) ?? 0);
		return {
			inboxPosition: resolveInboxPosition(this.config.get(OPTION_KEYS.inboxPosition), s.defaultInboxPosition),
			showDone: resolveShowDone(this.config.get(OPTION_KEYS.showDone), s.showDone),
			doneDays: Number.isFinite(days) && days > 0 ? days : null,
			typesOff: new Set(this.typesOff()),
		};
	}

	// ——— Data ———

	/** The Actions in the Bases result. */
	protected actions(): ActionItem[] {
		const { app } = this.plugin;
		const items: ActionItem[] = [];
		for (const entry of this.data.data) {
			const file = entry.file;
			if (frontmatterOf(app, file)?.['mtm-kind'] === 'action') items.push(actionItem(app, file, this.plugin.settings));
		}
		return items;
	}

	/** Every element for an Action carries data-path; selection only toggles a class. */
	protected markSelection(): void {
		const selected = this.plugin.selection.path;
		this.containerEl.querySelectorAll<HTMLElement>('[data-path]').forEach((el) => {
			el.toggleClass('is-selected', el.dataset.path === selected);
		});
	}

	protected async write(path: string, fn: (file: TFile) => Promise<void>): Promise<void> {
		const file = this.plugin.app.vault.getFileByPath(path);
		if (!file) return;
		try {
			await fn(file);
		} catch (e) {
			console.error('Matters that Matter: write failed', e);
			new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
		}
	}

	// ——— Handlers every view shares ———

	protected toggleType(typeId: string): void {
		const off = new Set(this.typesOff());
		if (off.has(typeId)) off.delete(typeId);
		else off.add(typeId);
		this.setConfigSoon(TYPES_OFF_KEY, off.size ? [...off] : null);
		this.refresh(true);
	}

	/** Back to "inherit" when the view would match the global setting, so it follows later changes to it. */
	protected toggleDone(): void {
		const show = !this.collectionOptions().showDone;
		this.config.set(OPTION_KEYS.showDone, show === this.plugin.settings.showDone ? null : show ? 'show' : 'hide');
		this.refresh(false);
	}

	protected select(path: string): void {
		void this.plugin.selectAction(path);
	}

	protected open(path: string, e: MouseEvent | KeyboardEvent): void {
		const file = this.plugin.app.vault.getFileByPath(path);
		if (!file) return;
		this.plugin.selection.set(path);
		const pane = e instanceof MouseEvent ? Keymap.isModEvent(e) : false;
		void this.plugin.app.workspace.getLeaf(pane || 'tab').openFile(file);
	}

	protected dismiss(item: ActionItem): void {
		void this.write(item.path, (file) => dismissOrphan(this.plugin.app, file, this.plugin.settings));
	}
}
