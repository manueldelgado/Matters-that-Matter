// What the board, list, calendar and timeline share as custom Bases views: options from the view config,
// the type chips, Show done, the Actions in the Bases result, selection, and writes.

import { BasesView, debounce, Keymap, Notice, type QueryController, type TFile } from 'obsidian';
import type MattersPlugin from '../../main';
import { STRINGS } from '../../strings';
import { resolveInboxPosition, resolveShowDone } from '../../model/actions';
import type { InboxPosition } from '../../model/matters';
import type { ActionItem } from '../../services/actionItems';
import { sphereKeysFor, type MatterInfo } from '../../services/boardModel';
import { NO_SPHERE, sphereShown } from '../../services/spheres';
import type { SphereChip } from './toolbar';
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
/** Sphere chips switched off, and Sphere bands collapsed, likewise. */
export const SPHERES_OFF_KEY = 'mtmSpheresOff';
export const SPHERES_COLLAPSED_KEY = 'mtmSpheresCollapsed';
const CONFIG_DELAY = 800;
export const NO_SPHERE_ICON = 'circle-dashed';

export interface CollectionOptions {
	inboxPosition: InboxPosition;
	showDone: boolean;
	/** "Show done from the last N days"; null shows all closed Actions. */
	doneDays: number | null;
	/** Type IDs switched off in the toolbar. */
	typesOff: ReadonlySet<string>;
	/** Sphere chips switched off (NO_SPHERE for "No Sphere"). */
	spheresOff: ReadonlySet<string>;
	/** Sphere bands collapsed on this view. */
	spheresCollapsed: ReadonlySet<string>;
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

	private stringList(key: string): string[] {
		const raw = this.configValue(key);
		return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
	}

	protected typesOff(): string[] {
		return this.stringList(TYPES_OFF_KEY);
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
			spheresOff: new Set(this.stringList(SPHERES_OFF_KEY)),
			spheresCollapsed: new Set(this.stringList(SPHERES_COLLAPSED_KEY)),
		};
	}

	/** Toolbar chips for the Spheres, with each one's open Actions in this view's data; none without Spheres. */
	protected sphereChips(matters: readonly MatterInfo[], actions: readonly ActionItem[], off: ReadonlySet<string>): SphereChip[] {
		const spheres = this.plugin.settings.spheres;
		const keys = sphereKeysFor(matters, spheres);
		const sphereOf = new Map(matters.map((m) => [m.path, m.isInbox ? null : (m.sphere ?? NO_SPHERE)]));
		const open = new Map<string, number>();
		for (const a of actions) {
			const key = sphereOf.get(a.effective.matterPath);
			if (key === null || key === undefined || a.category === 'closed') continue;
			open.set(key, (open.get(key) ?? 0) + 1);
		}
		return keys.map((key) => {
			const sphere = spheres.find((s) => s.id === key);
			return {
				key,
				label: sphere?.label ?? STRINGS.spheres.none,
				icon: sphere?.icon ?? NO_SPHERE_ICON,
				count: open.get(key) ?? 0,
				on: !off.has(key),
			};
		});
	}

	/** Whether a Matter's lane, group or rows show under the Sphere chips (the Inbox always does). */
	protected matterShown(matter: MatterInfo | undefined, matters: readonly MatterInfo[], off: ReadonlySet<string>): boolean {
		if (!matter || matter.isInbox) return true;
		const keys = sphereKeysFor(matters, this.plugin.settings.spheres);
		return keys.length === 0 || sphereShown(matter.sphere, off);
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

	protected toggleSphere(key: string): void {
		this.toggleIn(SPHERES_OFF_KEY, key);
	}

	protected toggleSphereCollapsed(key: string): void {
		this.toggleIn(SPHERES_COLLAPSED_KEY, key);
	}

	/** Shows only one Sphere: every other chip off. */
	protected showOnlySphere(key: string, keys: readonly string[]): void {
		const off = keys.filter((k) => k !== key);
		this.setConfigSoon(SPHERES_OFF_KEY, off.length ? off : null);
		this.refresh(true);
	}

	private toggleIn(configKey: string, key: string): void {
		const set = new Set(this.stringList(configKey));
		if (set.has(key)) set.delete(key);
		else set.add(key);
		this.setConfigSoon(configKey, set.size ? [...set] : null);
		this.refresh(true);
	}

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
		const pane = e.instanceOf(MouseEvent) ? Keymap.isModEvent(e) : false;
		void this.plugin.app.workspace.getLeaf(pane || 'tab').openFile(file);
	}

	protected dismiss(item: ActionItem): void {
		void this.write(item.path, (file) => dismissOrphan(this.plugin.app, file, this.plugin.settings));
	}
}
