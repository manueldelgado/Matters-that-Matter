// Vault-wide behaviour that runs once setup is done: completion and waiting-since dates on observed changes,
// Inbox protection and the ribbon counter.

import { debounce, normalizePath, Notice, TFile, type CachedMetadata } from 'obsidian';
import type MattersPlugin from '../main';
import { STRINGS } from '../strings';
import { toYmd } from '../model/dates';
import { hasCompletedValue, StatusCache } from '../services/completion';
import { linkText } from '../services/effective';
import { WaitingCache, type PersonRef } from '../services/waitingSince';
import { effectiveAction } from '../services/effective';
import { inboxRepairs, isInboxDuplicate } from '../services/inboxGuard';
import { linkedFile, resolverFor } from './index';
import { createNote, ensureFolder, frontmatterOf, notesOfKind, type Frontmatter } from './notes';

const INBOX_RESTORE_DELAY = 4000;
/** Time for the re-created Inbox's own changes to pass before the guard watches it again. */
const INBOX_SETTLE = 1500;

export class Watchers {
	private statuses = new StatusCache();
	private waiting = new WaitingCache();
	private ribbonEl: HTMLElement | null = null;
	private restoringInbox = false;
	private updateRibbon = debounce(() => this.renderRibbon(), 300, true);

	constructor(private plugin: MattersPlugin) {}

	/** Called once the layout is ready and setup is done. */
	start(ribbonEl: HTMLElement): void {
		const { app } = this.plugin;
		this.ribbonEl = ribbonEl;
		this.seedStatuses();
		this.warnInboxDuplicates();
		this.renderRibbon();

		this.plugin.registerEvent(app.metadataCache.on('changed', (file, _data, cache) => void this.onChanged(file, cache)));
		this.plugin.registerEvent(
			app.vault.on('delete', (file) => {
				this.statuses.forget(file.path);
				this.waiting.forget(file.path);
				if (file.path === this.plugin.settings.inboxPath) this.restoreInboxLater(file.path);
				this.updateRibbon();
			}),
		);
		this.plugin.registerEvent(
			app.vault.on('rename', (file, oldPath) => {
				this.statuses.rename(oldPath, file.path);
				this.waiting.rename(oldPath, file.path);
				if (file instanceof TFile) this.waiting.renamePerson(oldPath, file.path, file.basename);
				this.plugin.selection.rename(oldPath, file.path);
				this.updateRibbon();
			}),
		);
		this.plugin.registerEvent(
			this.plugin.events.on('settings-changed', () => {
				this.seedStatuses();
				this.updateRibbon();
			}),
		);
	}

	private seedStatuses(): void {
		const { app, settings } = this.plugin;
		this.statuses.clear();
		this.waiting.clear();
		for (const file of notesOfKind(app, 'action')) {
			const fm = frontmatterOf(app, file);
			const effective = effectiveAction(fm, settings, resolverFor(app, file.path));
			this.statuses.seed(file.path, fm?.['mtm-status'], effective.category);
			this.waiting.seed(file.path, this.personKey(file, fm?.['mtm-waiting-on']), fm?.['mtm-waiting-since']);
		}
	}

	/** The waiting-on person: the resolved path (or the link text) and the link text; null when absent. */
	private personKey(file: TFile, raw: unknown): PersonRef | null {
		const text = hasCompletedValue(raw) ? linkText(raw) : null;
		if (!text) return null;
		return { key: linkedFile(this.plugin.app, raw, file.path)?.path ?? text, text };
	}

	private async onChanged(file: TFile, cache: CachedMetadata): Promise<void> {
		const { app, settings } = this.plugin;
		const fm = cache.frontmatter;
		// While the Inbox is being re-created its first change has no properties yet: not a hand edit to repair.
		if (file.path === settings.inboxPath && !this.restoringInbox) await this.guardInbox(file, fm);

		if (fm?.['mtm-kind'] !== 'action') {
			this.statuses.forget(file.path);
			this.waiting.forget(file.path);
		} else {
			const effective = effectiveAction(fm, settings, resolverFor(app, file.path));
			const today = toYmd(new Date());
			const change = this.statuses.observe(file.path, fm['mtm-status'], effective.category, hasCompletedValue(fm['mtm-completed']));
			const since: unknown = fm['mtm-waiting-since'];
			let sinceChange = this.waiting.observe(file.path, this.personKey(file, fm['mtm-waiting-on']), since, hasCompletedValue(since));
			if (sinceChange === 'set' && since === today) sinceChange = 'none';
			if (change !== 'none' || sinceChange !== 'none') {
				await app.fileManager.processFrontMatter(file, (data: Frontmatter) => {
					if (change === 'set') data['mtm-completed'] = today;
					else if (change === 'remove') delete data['mtm-completed'];
					if (sinceChange === 'set') data['mtm-waiting-since'] = today;
					else if (sinceChange === 'remove') delete data['mtm-waiting-since'];
				});
			}
		}
		this.updateRibbon();
	}

	// ——— Inbox ———

	private async guardInbox(file: TFile, fm: Frontmatter | undefined): Promise<void> {
		const repairs = inboxRepairs(fm);
		if (Object.keys(repairs).length === 0) return;
		await this.plugin.app.fileManager.processFrontMatter(file, (data: Frontmatter) => Object.assign(data, repairs));
		new Notice(STRINGS.notices.inboxRestoredProperties);
	}

	/** Waits for a sync restore; re-creates the Inbox if it does not come back. */
	private restoreInboxLater(path: string): void {
		window.setTimeout(() => {
			const { app, settings } = this.plugin;
			if (settings.inboxPath !== path || app.vault.getAbstractFileByPath(normalizePath(path))) return;
			const slash = path.lastIndexOf('/');
			this.restoringInbox = true;
			void (async () => {
				// The folder may have gone with the note.
				if (slash > 0) await ensureFolder(app, path.slice(0, slash));
				await createNote(app, path, { 'mtm-kind': 'matter', 'mtm-icon': 'inbox', 'mtm-state': 'active' });
				new Notice(STRINGS.notices.inboxRecreated);
			})()
				.catch((e) => new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e))))
				.finally(() => window.setTimeout(() => (this.restoringInbox = false), INBOX_SETTLE));
		}, INBOX_RESTORE_DELAY);
	}

	private warnInboxDuplicates(): void {
		const { app, settings } = this.plugin;
		const duplicates = app.vault.getMarkdownFiles().filter((f) => isInboxDuplicate(f.path, settings.inboxPath));
		if (duplicates.length) new Notice(STRINGS.notices.inboxDuplicates(duplicates.map((f) => f.path)));
	}

	// ——— Ribbon ———

	/** Actions in the Inbox that are not closed (counted even when a board hides the Inbox). */
	inboxOpenCount(): number {
		const { app, settings } = this.plugin;
		let n = 0;
		for (const file of notesOfKind(app, 'action')) {
			const e = effectiveAction(frontmatterOf(app, file), settings, resolverFor(app, file.path));
			if (e.matterPath === settings.inboxPath && e.category !== 'closed') n++;
		}
		return n;
	}

	private renderRibbon(): void {
		const el = this.ribbonEl;
		if (!el) return;
		el.querySelector('.mtm-ribbon-badge')?.remove();
		const n = this.inboxOpenCount();
		if (n > 0) el.createSpan({ cls: 'mtm-ribbon-badge', text: String(n) });
	}
}
