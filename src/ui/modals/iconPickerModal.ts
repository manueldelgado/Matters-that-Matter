// Lucide icon picker for Matters and Action types.

import { getIconIds, Modal, setIcon, type App } from 'obsidian';
import { STRINGS } from '../../strings';
import { appendIcon, pressable } from '../components/dom';
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
		let shown: string[] = [];
		const cells = () => Array.from(grid.children).filter((c): c is HTMLElement => c.instanceOf(HTMLElement));
		/** One tab stop for the grid: the chosen icon, or the first one. */
		const setStop = () => {
			const all = cells();
			const stop = all.find((c) => c.hasClass('is-active')) ?? all[0];
			for (const c of all) c.setAttr('tabindex', c === stop ? 0 : -1);
			return stop;
		};
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
			shown = icons.slice(0, MAX_ICONS);
			for (const icon of shown) {
				const cell = grid.createDiv({ cls: 'mtm-icon-cell', attr: { 'aria-label': icon } });
				if (icon === this.selected) cell.addClass('is-active');
				setIcon(cell, icon);
				cell.addEventListener('mouseenter', () => showName(icon));
				cell.addEventListener('focus', () => showName(icon));
				pressable(cell, (e) => {
					// Enter on the chosen icon uses it, as a double-click does.
					if (e.instanceOf(KeyboardEvent) && e.key === 'Enter' && icon === this.selected) {
						this.pick(icon);
						return;
					}
					this.selected = icon;
					grid.querySelectorAll('.is-active').forEach((el) => el.removeClass('is-active'));
					cell.addClass('is-active');
					showName(icon);
					setStop();
				});
				cell.addEventListener('dblclick', () => this.pick(icon));
			}
			setStop();
		};
		// The arrow keys move through the grid; a row is as many cells as share the first one's top.
		grid.addEventListener('keydown', (e) => {
			const all = cells();
			const at = all.findIndex((c) => c === grid.doc.activeElement);
			if (at < 0) return;
			const top = all[0]?.offsetTop;
			const cols = Math.max(1, all.filter((c) => c.offsetTop === top).length);
			const steps: Partial<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
			const step = steps[e.key];
			if (step === undefined) return;
			e.preventDefault();
			if (at + step < 0 && e.key === 'ArrowUp') {
				input.focus();
				return;
			}
			all[Math.min(all.length - 1, Math.max(0, at + step))]?.focus();
		});
		// Enter in the search uses the chosen icon when the results show it, else the first match; Down moves into the grid.
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.isComposing) {
				e.preventDefault();
				const first = !input.value.trim() || shown.includes(this.selected) ? this.selected : shown[0];
				if (first) this.pick(first);
			} else if (e.key === 'ArrowDown') {
				e.preventDefault();
				setStop()?.focus();
			}
		});
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
