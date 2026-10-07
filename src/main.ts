import { Plugin } from 'obsidian';
import type { MattersSettings } from './settings';
import { migrateSettings } from './services/migrations';

export default class MattersPlugin extends Plugin {
	settings!: MattersSettings;

	async onload() {
		await this.loadSettings();
	}

	async loadSettings() {
		this.settings = migrateSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
