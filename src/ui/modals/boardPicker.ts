// Picks a board when the boards folder holds several .base files.

import { FuzzySuggestModal, type App, type TFile } from 'obsidian';

export class BoardPicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private boards: TFile[],
		private onPick: (file: TFile) => void,
	) {
		super(app);
	}

	getItems(): TFile[] {
		return this.boards;
	}

	getItemText(file: TFile): string {
		return file.basename;
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}
