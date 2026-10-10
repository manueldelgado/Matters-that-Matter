// Obsidian links: obsidian://mtm-add adds an Action, mtm-quick-add opens the Quick add dialog with text in it, and
// mtm-open opens an Action note, a Matter's overview or a board. Links add and open only: they never change or delete
// anything, and never create Matters or people. Whatever a link brings is made inert before it is written.

import { FileView, Notice, TFile, TFolder, normalizePath, type ObsidianProtocolData } from 'obsidian';
import type MattersPlugin from './main';
import { addAction } from './ops/addAction';
import { findMatter } from './ops/fields';
import { findAction } from './ops/findAction';
import { BurstLimiter, NoticeGap } from './services/burst';
import { findBoard, linkAddInput, linkQuickAddText, openRequest, shorten, shortenIn, type LinkParams } from './services/linkInput';
import { STRINGS } from './strings';
import { now } from './vault/clock';
import { cacheResolved } from './vault/internal';
import { applyPlan } from './vault/planWrites';
import { buildSnapshot } from './vault/snapshot';
import { showAddedNotice } from './ui/components/addedNotice';

const T = STRINGS.links;
/** The "links can't add Actions" notice shows at most once in this time, however many links arrive. */
const OFF_NOTICE_GAP_MS = 60_000;
/** How long a link waits for the metadata cache to finish reading the vault before it goes ahead anyway. */
const CACHE_WAIT_MS = 10_000;

export class LinkHandlers {
	/** Adds, and everything else links open (dialogs, notes, overviews, boards), are limited separately. */
	private readonly burst = new BurstLimiter();
	private readonly opens = new BurstLimiter();
	/** Repeated notices (turned off, not set up, nothing found) show once per gap. */
	private readonly notices = new NoticeGap();
	/** The Quick add dialog a link opened, while it is open. */
	private quickAddOpen = false;
	/** Links run one after another, so two adds can't race for the same file name. */
	private chain: Promise<void> = Promise.resolve();
	private ready: Promise<void> | null = null;

	constructor(private readonly plugin: MattersPlugin) {}

	/** Registers the handlers. Called in onload: nothing runs before the layout is ready and the vault is read. */
	register(): void {
		const handlers: [string, (params: LinkParams) => Promise<void>, (message: string) => string][] = [
			['mtm-add', (p) => this.add(p), T.addFailed],
			['mtm-quick-add', (p) => this.quickAdd(p), T.openFailed],
			['mtm-open', (p) => this.open(p), T.openFailed],
		];
		for (const [name, handler, failed] of handlers) {
			this.plugin.registerObsidianProtocolHandler(name, (params: ObsidianProtocolData) => this.enqueue(() => handler(params), failed));
		}
	}

	private enqueue(run: () => Promise<void>, failed: (message: string) => string): void {
		this.chain = this.chain
			.then(() => this.whenReady())
			.then(run)
			.catch((e) => {
				new Notice(failed(shorten(e instanceof Error ? e.message : String(e), 200)));
			});
	}

	/** Shows a notice unless the same one showed a moment ago. */
	private notice(message: string, gapMs?: number): void {
		if (this.notices.allow(message, now().getTime(), gapMs)) new Notice(message);
	}

	/** Whether another dialog, note or board may open from a link now (more than ten a minute stops them). */
	private mayOpen(): boolean {
		const verdict = this.opens.attempt(now().getTime());
		if (verdict.notify) new Notice(T.tooManyOpens);
		return verdict.allowed;
	}

	/** Layout ready (settings are loaded before the handlers exist), then the metadata cache has read the vault. */
	private whenReady(): Promise<void> {
		this.ready ??= new Promise<void>((resolve) => {
			const { app } = this.plugin;
			app.workspace.onLayoutReady(() => {
				if (cacheResolved(app) !== false) {
					resolve();
					return;
				}
				const ref = app.metadataCache.on('resolved', () => done());
				const timer = window.setTimeout(() => done(), CACHE_WAIT_MS);
				const done = () => {
					app.metadataCache.offref(ref);
					window.clearTimeout(timer);
					resolve();
				};
			});
		});
		return this.ready;
	}

	// ——— mtm-add ———

	private async add(params: LinkParams): Promise<void> {
		const { plugin } = this;
		const settings = plugin.settings;
		if (!settings.linksAddActions) {
			this.notice(T.turnedOff, OFF_NOTICE_GAP_MS);
			return;
		}
		if (!settings.setupDone) {
			this.notice(T.notSetUp);
			return;
		}
		const verdict = this.burst.attempt(now().getTime());
		if (!verdict.allowed) {
			if (verdict.notify) new Notice(T.tooMany);
			return;
		}
		// Adding never reads a note's content, so none is read ahead.
		const snapshot = await buildSnapshot(plugin.app, settings, { contents: false });
		const result = addAction(linkAddInput(params), snapshot);
		if (!result.ok) {
			this.notice(T.notAdded(shortenIn(result.error.message, result.error.value)));
			return;
		}
		await applyPlan(plugin.app, result.plan);
		const { action } = result.value;
		showAddedNotice(plugin, {
			path: action.path,
			title: action.title,
			type: settings.types.find((t) => t.id === action.type.id),
			matter: action.matter.name,
			status: action.status.label,
			source: T.fromLink,
		});
	}

	// ——— mtm-quick-add ———

	/** Opens the dialog with the link's text; a link that arrives while a Quick add dialog is open is ignored. */
	private quickAdd(params: LinkParams): Promise<void> {
		if (!this.plugin.settings.setupDone) this.notice(T.notSetUp);
		else if (!this.quickAddOpen && !activeDocument.querySelector('.modal.mtm-quick-add') && this.mayOpen()) {
			this.quickAddOpen = true;
			this.plugin.quickAdd({ text: linkQuickAddText(params), onClose: () => (this.quickAddOpen = false) });
		}
		return Promise.resolve();
	}

	// ——— mtm-open ———

	private async open(params: LinkParams): Promise<void> {
		const { plugin } = this;
		if (!plugin.settings.setupDone) {
			this.notice(T.notSetUp);
			return;
		}
		if (!this.mayOpen()) return;
		const request = openRequest(params);
		const name = shorten(request.ref ?? '');
		if (request.kind === 'board') {
			await this.openBoard(request.ref);
			return;
		}
		const snapshot = await buildSnapshot(plugin.app, plugin.settings, { contents: false });
		if (request.kind === 'action') {
			const found = findAction(request.ref, snapshot);
			if (found.ok) await this.openNote(found.value.note.path);
			else if (found.error.code === 'ambiguous') this.notice(T.severalActions(name, found.error.candidates?.[0] ?? ''));
			else this.notice(T.noAction(name));
			return;
		}
		const found = findMatter(request.ref, snapshot);
		if (found.ok) await plugin.openMatter(found.value.path);
		else if (found.error.code === 'ambiguous') this.notice(T.severalMatters(name, found.error.candidates?.[0] ?? ''));
		else this.notice(T.noMatter(name));
	}

	/** A board by path or name in the boards folder; without one, the board as the ribbon opens it. */
	private async openBoard(ref: string | null): Promise<void> {
		const { plugin } = this;
		if (ref === null) {
			await plugin.openBoard();
			return;
		}
		const folder = plugin.app.vault.getAbstractFileByPath(normalizePath(plugin.settings.folders.boards));
		const inFolder = folder instanceof TFolder ? folder.children.filter((f) => f instanceof TFile && f.extension === 'base').map((f) => f.path) : [];
		const boards = [...new Set([...inFolder, normalizePath(plugin.settings.boardPath)])];
		const found = findBoard(ref, boards);
		const file = found.kind === 'match' ? plugin.app.vault.getFileByPath(found.path) : null;
		if (file) await plugin.openBoardFile(file);
		else if (found.kind === 'several') this.notice(T.severalBoards(shorten(ref), found.paths[0] ?? ''));
		else this.notice(T.noBoard(shorten(ref)));
	}

	/** Brings forward a tab that shows the note, else opens it in an empty tab or a new one, never over another note. */
	private async openNote(path: string): Promise<void> {
		const { workspace, vault } = this.plugin.app;
		const file = vault.getFileByPath(path);
		if (!file) return;
		const open = workspace.getLeavesOfType('markdown').find((leaf) => leaf.view instanceof FileView && leaf.view.file?.path === path);
		if (open) {
			await workspace.revealLeaf(open);
			workspace.setActiveLeaf(open, { focus: true });
			return;
		}
		const active = workspace.getMostRecentLeaf();
		const leaf = active && active.view.getViewType() === 'empty' ? active : workspace.getLeaf('tab');
		await leaf.openFile(file);
	}
}
