// A plain confirmation dialog.

import { Modal, type App } from 'obsidian';
import { STRINGS } from '../../strings';

export interface ConfirmOptions {
	title: string;
	body: string;
	confirm: string;
	danger?: boolean;
	onConfirm(): void | Promise<void>;
}

export class ConfirmModal extends Modal {
	constructor(app: App, private opts: ConfirmOptions) {
		super(app);
	}

	onOpen(): void {
		const { opts, contentEl } = this;
		this.modalEl.addClass('mtm-modal');
		if (opts.danger) this.modalEl.addClass('mod-danger');
		contentEl.empty();
		contentEl.createDiv({ cls: 'mtm-modal-head' }).createEl('h2', { cls: 'mtm-modal-title', text: opts.title });
		contentEl.createDiv({ cls: 'mtm-modal-body' }).createSpan({ text: opts.body });
		const footer = contentEl.createDiv({ cls: 'mtm-modal-footer' });
		footer.createEl('button', { text: STRINGS.modals.cancel }).addEventListener('click', () => this.close());
		const ok = footer.createEl('button', { cls: opts.danger ? 'mod-warning' : 'mod-cta', text: opts.confirm });
		ok.addEventListener('click', () => {
			ok.disabled = true;
			void Promise.resolve(opts.onConfirm()).finally(() => this.close());
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
