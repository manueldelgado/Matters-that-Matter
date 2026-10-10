// The `matters` code block: a light list of Actions inside a note. Its query is quick add's tokens plus a few words
// (services/embedQuery.ts); an empty block reads the note it's in. Cards behave as everywhere; the block never writes.

import { debounce, Keymap, MarkdownRenderChild, Notice, setTooltip } from 'obsidian';
import type MattersPlugin from '../../main';
import { STRINGS } from '../../strings';
import { toYmd } from '../../model/dates';
import type { ActionItem } from '../../services/actionItems';
import { embedItems, embedTitle, parseEmbedQuery, type EmbedNote, type EmbedQuery, type EmbedSubject } from '../../services/embedQuery';
import { personToken } from '../../services/personModel';
import { avatarEl, bindCardActions, renderCard } from '../../ui/components/card';
import { appendIcon, iconEl, pressable } from '../../ui/components/dom';
import { dismissOrphan } from '../../vault/actionWrites';
import { loadCandidates } from '../../vault/candidates';
import { allActionItems, linkedFile, peopleIndex, peoplePaths } from '../../vault/index';
import { frontmatterOf } from '../../vault/notes';

export const EMBED_LANGUAGE = 'matters';

export function registerMattersEmbed(plugin: MattersPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor(EMBED_LANGUAGE, (source, el, ctx) => {
		ctx.addChild(new MattersEmbed(el, plugin, source, ctx.sourcePath));
	});
}

class MattersEmbed extends MarkdownRenderChild {
	private signature = '';
	private renderSoon = debounce(() => this.render(), 150, true);

	constructor(
		el: HTMLElement,
		private plugin: MattersPlugin,
		private source: string,
		private sourcePath: string,
	) {
		super(el);
	}

	onload(): void {
		const { app } = this.plugin;
		this.render();
		this.registerEvent(app.metadataCache.on('changed', () => this.renderSoon()));
		this.registerEvent(app.vault.on('rename', () => this.renderSoon()));
		this.registerEvent(app.vault.on('delete', () => this.renderSoon()));
		this.registerEvent(this.plugin.events.on('settings-changed', () => this.renderSoon()));
		this.registerEvent(this.plugin.selection.on('changed', () => this.render()));
		// Today and late change with the clock.
		this.registerInterval(window.setInterval(() => this.render(), 60_000));
	}

	onunload(): void {
		this.renderSoon.cancel();
	}

	private note(): EmbedNote {
		const { app, settings } = this.plugin;
		const file = app.vault.getFileByPath(this.sourcePath);
		if (!file || this.source.trim()) return { path: this.sourcePath, kind: 'other' };
		if (frontmatterOf(app, file)?.['mtm-kind'] === 'matter') return { path: file.path, kind: 'matter' };
		return { path: file.path, kind: peopleIndex(app, settings).has(file.path) ? 'person' : 'other' };
	}

	/** Actions with the people they name, resolved only when the query asks about people. */
	private subjects(q: EmbedQuery): EmbedSubject[] {
		const { app, settings } = this.plugin;
		return allActionItems(app, settings).map((item) => {
			if (!q.people.length) return { item, people: new Set<string>(), waitingOn: null };
			const file = app.vault.getFileByPath(item.path);
			const fm = file ? (frontmatterOf(app, file) ?? {}) : {};
			return { item, people: peoplePaths(app, fm, item.path), waitingOn: linkedFile(app, fm['mtm-waiting-on'], item.path)?.path ?? null };
		});
	}

	private render(): void {
		const { app, settings } = this.plugin;
		if (!settings.setupDone) return;
		const now = new Date();
		const today = toYmd(now);
		const candidates = loadCandidates(app, settings);
		const q = parseEmbedQuery(this.source, { now, ...candidates, languages: settings.dateLanguages }, this.note(), today);
		const { items, total } = embedItems(this.subjects(q), q, settings.statuses, now);
		const baseName = (path: string) => app.vault.getFileByPath(path)?.basename ?? path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
		const title = embedTitle(
			q,
			{
				matter: baseName,
				person: baseName,
				type: (id) => settings.types.find((t) => t.id === id)?.label ?? id,
				status: (id) => settings.statuses.find((s) => s.id === id)?.label ?? '',
			},
			settings.statuses,
			today,
		);
		const oneMatter = q.matters.length === 1 ? q.matters[0] : undefined;
		const matterOf = (item: ActionItem) => {
			const path = item.effective.matterPath;
			const file = app.vault.getFileByPath(path);
			const icon = path === settings.inboxPath ? 'inbox' : file ? frontmatterOf(app, file)?.['mtm-icon'] : undefined;
			return { name: baseName(path), icon: typeof icon === 'string' && icon ? icon : 'circle-dot' };
		};

		const selected = this.plugin.selection.path;
		const signature = JSON.stringify([
			title,
			q.invalid,
			total,
			today,
			selected,
			items.map((i) => [i.path, i.title, i.category, i.effective.type, i.effective.orphans, i.due, i.priority, i.waitingOn, i.waitingSince, i.linkedCount, i.effective.matterPath]),
		]);
		if (signature === this.signature) return;
		this.signature = signature;

		const el = this.containerEl;
		el.empty();
		const add = (parent: HTMLElement) => {
			const button = parent.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': STRINGS.embed.newAction } });
			appendIcon(button, 'plus');
			button.addEventListener('click', () => this.newAction(q));
		};
		const invalid = (parent: HTMLElement) => {
			for (const text of q.invalid) setTooltip(parent.createSpan({ cls: ['mtm-token', 'mod-invalid'], text }), STRINGS.embed.invalid);
		};

		if (!items.length) {
			const quiet = el.createDiv({ cls: ['mtm-embed', 'mod-quiet'] });
			appendIcon(quiet, 'circle-check');
			quiet.createSpan({ text: oneMatter ? STRINGS.embed.nothingIn(baseName(oneMatter)) : STRINGS.embed.nothing });
			invalid(quiet);
			add(quiet);
			return;
		}

		const embed = el.createDiv({ cls: 'mtm-embed' });
		const head = embed.createDiv({ cls: 'mtm-embed-head' });
		if (oneMatter) {
			const file = app.vault.getFileByPath(oneMatter);
			const icon = oneMatter === settings.inboxPath ? 'inbox' : file ? frontmatterOf(app, file)?.['mtm-icon'] : undefined;
			iconEl(head, typeof icon === 'string' && icon ? icon : 'circle-dot', 'mtm-matter-icon');
		} else if (q.people.length === 1 && q.people[0]) avatarEl(head, baseName(q.people[0]));
		head.createSpan({ cls: 'mtm-embed-title', text: title });
		invalid(head);
		head.createSpan({ cls: 'mtm-spacer' });
		head.createSpan({ cls: 'mtm-col-count', text: String(total) });
		add(head);

		const grid = embed.createDiv({ cls: 'mtm-embed-grid' });
		for (const item of items) {
			const matter = oneMatter ? null : matterOf(item);
			const card = renderCard(grid, item, {
				now,
				selected: item.path === selected,
				...(matter ? { matterName: matter.name, matterIcon: matter.icon } : {}),
				onDismiss: (i) => this.dismiss(i),
			});
			card.setAttr('draggable', 'false');
			bindCardActions(card, item.path, {
				select: (path) => void this.plugin.selectAction(path),
				open: (path, e) => {
					this.plugin.selection.set(path);
					void app.workspace.openLinkText(path, this.sourcePath, Keymap.isModEvent(e));
				},
			});
		}
		if (total > items.length) {
			const more = pressable(embed.createSpan({ cls: 'mtm-section-more', text: STRINGS.embed.more(total - items.length, oneMatter ? 'overview' : 'board') }), () => {
				if (oneMatter) void this.plugin.openMatter(oneMatter);
				else void this.plugin.openBoard();
			});
			more.setAttr('role', 'link');
		}
	}

	/** Quick add with the block's own tokens; an empty block in a Matter or person note starts there. */
	private newAction(q: EmbedQuery): void {
		const { app } = this.plugin;
		const person = q.context === 'person' && q.people[0] ? app.vault.getFileByPath(q.people[0])?.basename : undefined;
		const text = [q.prefill, person ? personToken(person) : ''].filter(Boolean).join(' ');
		this.plugin.quickAdd({
			...(q.context === 'matter' && q.matters[0] ? { matterPath: q.matters[0] } : {}),
			...(text ? { text: `${text} ` } : {}),
		});
	}

	private dismiss(item: ActionItem): void {
		const { app, settings } = this.plugin;
		const file = app.vault.getFileByPath(item.path);
		if (file) void dismissOrphan(app, file, settings).catch((err: unknown) => new Notice(STRINGS.notices.writeFailed(err instanceof Error ? err.message : String(err))));
	}
}
