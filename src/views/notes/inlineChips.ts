// Links to Actions as chips in notes: reading view through a Markdown post-processor, Live Preview through an editor
// extension (livePreviewChips.ts). Chips follow their Action: a change to it, or to the settings, redraws them.

import { getLinkpath, MarkdownView, type MarkdownPostProcessorContext } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type MattersPlugin from '../../main';
import { chipModel, type ChipModel } from '../../services/inlineChip';
import { CHIP_PATH_ATTR, fillChip } from '../../ui/components/inlineChip';
import { actionItem } from '../../vault/index';
import { frontmatterOf } from '../../vault/notes';
import { livePreviewChips, refreshChips } from './livePreviewChips';

/** Links that are never chips: in embeds, properties, our own banners, or chips already. */
const SKIP = '.mtm-inline, .internal-embed, .metadata-container, .mtm-note-banner, .mtm-person-banner, .mtm-matter-banner';

/** A chip not yet in the page (post-processors render off-screen) is kept this long before it's forgotten. */
const ATTACH_GRACE_MS = 10_000;

export class InlineChips {
	/** Reading-view chips and when they were made. */
	private chips = new Map<HTMLElement, number>();
	/** Live Preview editors showing chips. */
	readonly editors = new Set<EditorView>();
	private enabled: boolean;

	constructor(private plugin: MattersPlugin) {
		this.enabled = plugin.settings.inlineChips;
	}

	/** Whether chips show now. */
	isOn(): boolean {
		return this.plugin.settings.setupDone && this.plugin.settings.inlineChips;
	}

	/** Called once the layout is ready and setup is done. */
	start(): void {
		const { app } = this.plugin;
		this.plugin.registerMarkdownPostProcessor((el, ctx) => this.process(el, ctx));
		this.plugin.registerEditorExtension(livePreviewChips(this));
		this.plugin.registerEvent(app.metadataCache.on('changed', (file) => this.refresh(file.path)));
		this.plugin.registerEvent(
			app.vault.on('rename', (file, oldPath) => {
				this.refresh(oldPath);
				this.refresh(file.path);
			}),
		);
		this.plugin.registerEvent(app.vault.on('delete', (file) => this.refresh(file.path)));
		this.plugin.registerEvent(
			this.plugin.events.on('settings-changed', () => {
				const on = this.plugin.settings.inlineChips;
				if (on !== this.enabled) {
					this.enabled = on;
					if (on) this.rerenderPreviews();
					else this.unwrapAll();
				}
				this.refresh(null);
			}),
		);
		// "Today" and overdue change with the clock; chips redraw only when what they show changes.
		this.plugin.registerInterval(window.setInterval(() => this.refresh(null), 60_000));
		this.plugin.register(() => this.unwrapAll());
		// Notes already open in reading view were rendered before the post-processor existed.
		this.rerenderPreviews();
	}

	/** The chip model for a link target, or null when it isn't an Action note. */
	modelFor(linktext: string, sourcePath: string): ChipModel | null {
		const { app } = this.plugin;
		const file = app.metadataCache.getFirstLinkpathDest(getLinkpath(linktext), sourcePath);
		if (!file || frontmatterOf(app, file)?.['mtm-kind'] !== 'action') return null;
		return chipModel(actionItem(app, file, this.plugin.settings));
	}

	private modelForPath(path: string): ChipModel | null {
		const { app } = this.plugin;
		const file = app.vault.getFileByPath(path);
		if (!file || frontmatterOf(app, file)?.['mtm-kind'] !== 'action') return null;
		return chipModel(actionItem(app, file, this.plugin.settings));
	}

	private process(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		if (!this.isOn()) return;
		const now = new Date();
		for (const link of Array.from(el.querySelectorAll<HTMLElement>('a.internal-link'))) {
			if (link.closest(SKIP)) continue;
			const href = link.dataset.href ?? link.getAttr('href');
			if (!href) continue;
			const model = this.modelFor(href, ctx.sourcePath);
			if (!model) continue;
			const chip = createSpan();
			link.replaceWith(chip);
			chip.appendChild(link);
			fillChip(chip, link, model, now, link.textContent ?? '');
			this.chips.set(chip, Date.now());
		}
	}

	/** Redraws the chips pointing at `path` (all of them with null); unwraps those whose target is no longer an Action. */
	private refresh(path: string | null): void {
		if (this.isOn()) for (const view of this.editors) view.dispatch({ effects: refreshChips.of(null) });
		const now = new Date();
		const models = new Map<string, ChipModel | null>();
		for (const [chip, made] of this.chips) {
			if (!chip.isConnected) {
				if (Date.now() - made > ATTACH_GRACE_MS) this.chips.delete(chip);
				continue;
			}
			const target = chip.getAttr(CHIP_PATH_ATTR);
			if (!target || (path !== null && target !== path)) continue;
			if (!models.has(target)) models.set(target, this.isOn() ? this.modelForPath(target) : null);
			const link = chip.querySelector<HTMLElement>('a.internal-link');
			const model = models.get(target);
			if (!link) continue;
			if (model) fillChip(chip, link, model, now, link.textContent ?? '');
			else this.unwrap(chip, link);
		}
	}

	private unwrap(chip: HTMLElement, link: HTMLElement): void {
		chip.replaceWith(link);
		this.chips.delete(chip);
	}

	private unwrapAll(): void {
		for (const chip of Array.from(this.chips.keys())) {
			const link = chip.querySelector<HTMLElement>('a.internal-link');
			if (link && chip.isConnected) this.unwrap(chip, link);
		}
		this.chips.clear();
		for (const view of this.editors) view.dispatch({ effects: refreshChips.of(null) });
	}

	private rerenderPreviews(): void {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') leaf.view.previewMode.rerender(true);
		});
	}

	/** Opens a chip's target as a link would (Live Preview; reading view keeps Obsidian's own link). */
	open(linktext: string, sourcePath: string, newTab: boolean | 'tab' | 'split' | 'window'): void {
		void this.plugin.app.workspace.openLinkText(linktext, sourcePath, newTab);
	}

	/** Obsidian's page preview on hover, as for a link in the editor. */
	hover(event: MouseEvent, target: HTMLElement, linktext: string, sourcePath: string, parent: unknown): void {
		this.plugin.app.workspace.trigger('hover-link', { event, source: 'editor', hoverParent: parent, targetEl: target, linktext, sourcePath });
	}
}
