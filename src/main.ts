import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, MattersSettings } from './settings';

export default class MattersPlugin extends Plugin {
	settings!: MattersSettings;

	async onload() {
		await this.loadSettings();
	}

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<MattersSettings> | null;
		this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...saved };
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
