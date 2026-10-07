// "Delete status / type" with a destination for the Actions that use it.

import { Modal, type App } from 'obsidian';
import { STRINGS } from '../../strings';
import { tileEl } from '../components/dom';

export interface Destination {
	id: string;
	/** Renders the destination's label (status chip, or type tile and name). */
	render(el: HTMLElement): void;
	/** Classes for the destination row (type tone classes). */
	classes?: string[];
}

export interface DeleteOptions {
	kind: 'status' | 'type';
	label: string;
	count: number;
	destinations: Destination[];
	/** Preselected destination (the backlog status or the default type). */
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
		this.modalEl.addClasses(['mtm-modal', 'mod-danger']);
		contentEl.empty();

		const head = contentEl.createDiv({ cls: 'mtm-modal-head' });
		tileEl(head, 'trash-2', 'mod-lg');
		head.createEl('h2', { cls: 'mtm-modal-title', text: STRINGS.modals.deleteTitle(opts.label) });

		const body = contentEl.createDiv({ cls: 'mtm-modal-body' });
		if (opts.count === 0) {
			body.createSpan({ text: STRINGS.modals.deleteNone(opts.kind) });
		} else {
			body.createSpan({ text: STRINGS.modals.deleteCount(opts.count, opts.kind) });
			const list = body.createDiv({ cls: 'mtm-destinations' });
			const rows: [string, HTMLElement, HTMLElement][] = [];
			const refresh = () => {
				for (const [id, row, meta] of rows) {
					row.toggleClass('is-active', id === this.choice);
					meta.setText(id === this.choice ? STRINGS.modals.willMove(opts.count) : '');
				}
			};
			for (const dest of opts.destinations) {
				const row = list.createDiv({ cls: ['mtm-destination', ...(dest.classes ?? [])], attr: { role: 'radio' } });
				row.createSpan({ cls: 'mtm-destination-radio' });
				dest.render(row);
				const meta = row.createSpan({ cls: 'mtm-destination-meta' });
				rows.push([dest.id, row, meta]);
				row.addEventListener('click', () => {
					this.choice = dest.id;
					refresh();
				});
			}
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
			void opts.onConfirm(this.choice).finally(() => this.close());
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
