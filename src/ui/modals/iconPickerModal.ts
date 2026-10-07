// Lucide icon picker for Matters and Action types.

import { getIconIds, Modal, setIcon, type App } from 'obsidian';
import { STRINGS } from '../../strings';
import { appendIcon } from '../components/dom';
import { matchScore } from '../../services/fuzzy';

const MAX_ICONS = 240;

let lucideIds: string[] | null = null;

/** Lucide icon names without the "lucide-" prefix, sorted. */
function lucideIcons(): string[] {
	lucideIds ??= getIconIds()
		.filter((id) => id.startsWith('lucide-'))
		.map((id) => id.slice('lucide-'.length))
		.sort();
	return lucideIds;
}

export class IconPickerModal extends Modal {
	private selected: string;

	constructor(
		app: App,
		current: string,
		private onPick: (icon: string) => void,
		private toneClasses: string[] = [],
	) {
		super(app);
		this.selected = current;
	}

	onOpen(): void {
		this.modalEl.addClasses(['mtm-modal', 'mtm-icon-picker', ...this.toneClasses]);
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createDiv({ cls: 'mtm-modal-head' }).createEl('h2', { cls: 'mtm-modal-title', text: STRINGS.modals.iconPicker });

		const body = contentEl.createDiv({ cls: 'mtm-modal-body' });
		const search = body.createDiv({ cls: 'mtm-input-icon' });
		appendIcon(search, 'search');
		const input = search.createEl('input', { type: 'text', attr: { placeholder: STRINGS.modals.searchIcons } });
		const grid = body.createDiv({ cls: 'mtm-icon-grid' });
		const name = body.createSpan({ cls: 'mtm-icon-picker-name' });

		const showName = (icon: string) => name.setText(`${icon} · Lucide`);
		const render = () => {
			grid.empty();
			const query = input.value.trim();
			const icons = query
				? lucideIcons()
						.map((icon) => ({ icon, score: matchScore(query, icon.replace(/-/g, ' ')) }))
						.filter((r) => r.score >= 0.8)
						.sort((a, b) => b.score - a.score)
						.map((r) => r.icon)
				: lucideIcons();
			for (const icon of icons.slice(0, MAX_ICONS)) {
				const cell = grid.createDiv({ cls: 'mtm-icon-cell', attr: { 'aria-label': icon, role: 'button' } });
				if (icon === this.selected) cell.addClass('is-active');
				setIcon(cell, icon);
				cell.addEventListener('mouseenter', () => showName(icon));
				cell.addEventListener('click', () => {
					this.selected = icon;
					grid.querySelectorAll('.is-active').forEach((el) => el.removeClass('is-active'));
					cell.addClass('is-active');
					showName(icon);
				});
				cell.addEventListener('dblclick', () => this.pick(icon));
			}
		};
		input.addEventListener('input', render);
		render();
		showName(this.selected);
		input.focus();

		const footer = contentEl.createDiv({ cls: 'mtm-modal-footer' });
		footer.createEl('button', { text: STRINGS.modals.cancel }).addEventListener('click', () => this.close());
		footer
			.createEl('button', { cls: 'mod-cta', text: STRINGS.modals.useIcon })
			.addEventListener('click', () => this.pick(this.selected));
	}

	private pick(icon: string): void {
		this.close();
		this.onPick(icon);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
