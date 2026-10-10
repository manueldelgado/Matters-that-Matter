// "Fix orphaned Actions": confirms what changes, one row per unrecognised value, then writes the fallbacks.

import { Modal, setIcon, type App } from 'obsidian';
import { STRINGS } from '../../strings';
import { linkText } from '../../services/effective';
import type { OrphanGroup, OrphanSummary } from '../../services/orphanSummary';
import { appendIcon, statusChip, tileEl, typeClasses } from '../components/dom';

const ICONS = { status: 'circle-dashed', type: 'shapes', matter: 'folder-x' } as const;

export class FixOrphansModal extends Modal {
	constructor(
		app: App,
		private summary: OrphanSummary,
		private inboxName: string,
		private onConfirm: () => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const f = STRINGS.fixOrphans;
		const n = this.summary.items.length;
		const { contentEl } = this;
		this.modalEl.addClasses(['mtm-modal', 'has-head-tile']);
		contentEl.empty();

		const head = contentEl.createDiv({ cls: 'mtm-modal-head' });
		tileEl(head, 'wrench', 'mod-lg mtm-tone-butter');
		head.createEl('h2', { cls: 'mtm-modal-title', text: f.title(n) });

		const body = contentEl.createDiv({ cls: 'mtm-modal-body' });
		body.createSpan({ text: f.body });
		const list = body.createDiv({ cls: 'mtm-summary-list' });
		for (const group of this.summary.groups) this.renderRow(list, group);
		body.createSpan({ cls: 'mtm-field-hint', text: f.hint });

		const footer = contentEl.createDiv({ cls: 'mtm-modal-footer' });
		footer.createEl('button', { text: STRINGS.modals.cancel }).addEventListener('click', () => this.close());
		const ok = footer.createEl('button', { cls: 'mod-cta', text: f.confirm(n) });
		ok.addEventListener('click', () => {
			ok.disabled = true;
			void this.onConfirm().finally(() => this.close());
		});
	}

	private renderRow(list: HTMLElement, group: OrphanGroup): void {
		const labels = STRINGS.card.orphanLabels;
		const row = list.createDiv({ cls: ['mtm-summary-item', 'mod-modify', 'mtm-fix-row'] });
		const badge = row.createSpan({ cls: ['mtm-orphan', `mod-${group.field}`] });
		appendIcon(badge, ICONS[group.field]);
		badge.createSpan({ cls: 'mtm-orphan-label', text: labels[group.field] });
		const raw = group.field === 'matter' ? (linkText(group.raw) ?? group.raw) : group.raw;
		badge.createSpan({ cls: 'mtm-orphan-value', text: `“${raw}”` });

		const arrow = row.createSpan({ cls: 'mtm-fix-arrow' });
		setIcon(arrow, 'arrow-right');

		const to = row.createSpan({ cls: 'mtm-fix-to' });
		if (group.status) statusChip(to, group.status);
		else if (group.type) {
			to.addClasses(typeClasses(group.type));
			tileEl(to, group.type.icon);
			to.appendText(group.type.label);
		} else {
			setIcon(to.createSpan({ cls: 'mtm-matter-icon' }), 'inbox');
			to.appendText(this.inboxName);
		}
		row.createSpan({ cls: 'mtm-summary-note', text: STRINGS.fixOrphans.count(group.count) });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
