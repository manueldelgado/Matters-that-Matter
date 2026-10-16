// "Delete status / type / Sphere" with a destination for the Actions (or Matters) that use it.

import { Modal, type App } from 'obsidian';
import { STRINGS } from '../../strings';
import { tileEl, reportWriteFailed } from '../components/dom';

/** How far each arrow key moves the choice. */
const ARROWS: Partial<Record<string, number>> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

export interface Destination {
	id: string;
	/** Renders the destination's label (status chip, or type tile and name). */
	render(el: HTMLElement): void;
	/** Classes for the destination row (type tone classes). */
	classes?: string[];
}

export interface DeleteOptions {
	kind: 'status' | 'type' | 'Sphere';
	label: string;
	count: number;
	destinations: Destination[];
	/** Preselected destination (the backlog status, the default type, or No Sphere). */
	preselect: string;
	/** Moves the Actions, then removes the item. */
	onConfirm(destinationId: string): Promise<void>;
}

export class DeleteModal extends Modal {
	private choice: string;

	constructor(app: App, private opts: DeleteOptions) {
		super(app);
		this.choice = opts.preselect;
	}

	onOpen(): void {
		const { opts, contentEl } = this;
		this.modalEl.addClasses(['mtm-modal', 'mod-danger', 'has-head-tile']);
		contentEl.empty();

		const head = contentEl.createDiv({ cls: 'mtm-modal-head' });
		tileEl(head, 'trash-2', 'mod-lg');
		head.createEl('h2', { cls: 'mtm-modal-title', text: STRINGS.modals.deleteTitle(opts.label) });

		const body = contentEl.createDiv({ cls: 'mtm-modal-body' });
		if (opts.count === 0) {
			body.createSpan({ text: STRINGS.modals.deleteNone(opts.kind) });
		} else {
			body.createSpan({ text: STRINGS.modals.deleteCount(opts.count, opts.kind) });
			const list = body.createDiv({ cls: 'mtm-destinations', attr: { role: 'radiogroup' } });
			const rows: [string, HTMLElement, HTMLElement][] = [];
			const refresh = () => {
				for (const [id, row, meta] of rows) {
					const active = id === this.choice;
					row.toggleClass('is-active', active);
					// One stop in the tab order: the chosen destination; the arrow keys move between them.
					row.setAttrs({ 'aria-checked': String(active), tabindex: active ? 0 : -1 });
					meta.setText(active ? STRINGS.modals.willMove(opts.count) : '');
				}
			};
			const choose = (index: number) => {
				const entry = rows[(index + rows.length) % rows.length];
				if (!entry) return;
				this.choice = entry[0];
				refresh();
				entry[1].focus();
			};
			opts.destinations.forEach((dest, index) => {
				const row = list.createDiv({ cls: ['mtm-destination', ...(dest.classes ?? [])], attr: { role: 'radio' } });
				row.createSpan({ cls: 'mtm-destination-radio' });
				dest.render(row);
				const meta = row.createSpan({ cls: 'mtm-destination-meta' });
				rows.push([dest.id, row, meta]);
				row.addEventListener('click', () => choose(index));
				row.addEventListener('keydown', (e) => {
					const step = ARROWS[e.key];
					if (step !== undefined) choose(index + step);
					else if (e.key === 'Enter' || e.key === ' ') choose(index);
					else return;
					e.preventDefault();
				});
			});
			refresh();
		}

		const footer = contentEl.createDiv({ cls: 'mtm-modal-footer' });
		footer.createEl('button', { text: STRINGS.modals.cancel }).addEventListener('click', () => this.close());
		const confirm = footer.createEl('button', {
			cls: 'mod-warning',
			text: opts.count === 0 ? STRINGS.modals.delete : STRINGS.modals.deleteAndMove,
		});
		confirm.addEventListener('click', () => {
			confirm.disabled = true;
			void Promise.resolve()
				.then(() => opts.onConfirm(this.choice))
				.catch(reportWriteFailed)
				.finally(() => this.close());
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
