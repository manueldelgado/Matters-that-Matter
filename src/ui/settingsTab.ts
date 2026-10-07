// Settings tab: folders, board defaults, and the status and type editors.

import { debounce, normalizePath, Notice, PluginSettingTab, Setting, type App } from 'obsidian';
import type MattersPlugin from '../main';
import type { MattersSettings, StatusDef, TypeDef } from '../settings';
import { STRINGS } from '../strings';
import { backlogStatus, defaultType } from '../model/workflow';
import { actionsUsing, moveStatus, moveType } from '../vault/workflowWrites';
import { statusChip, tileEl, typeClasses } from './components/dom';
import { StatusEditor } from './components/statusEditor';
import { TypeEditor } from './components/typeEditor';
import { DeleteModal } from './modals/deleteModal';

type FolderKey = keyof MattersSettings['folders'];

export class MattersSettingTab extends PluginSettingTab {
	private statusEditor: StatusEditor | null = null;
	private typeEditor: TypeEditor | null = null;
	private saveSoon = debounce(() => void this.plugin.saveSettings(), 400, true);

	constructor(app: App, private plugin: MattersPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = STRINGS.settings;
		containerEl.empty();
		containerEl.addClass('mtm-settings');

		const hero = containerEl.createDiv({ cls: 'mtm-settings-hero' });
		const heroText = hero.createDiv();
		heroText.createDiv({ cls: 'mtm-settings-hero-title', text: STRINGS.pluginName });
		heroText.createDiv({ cls: 'mtm-settings-hero-sub', text: s.heroSub });
		hero.createSpan({ cls: 'mtm-spacer' });
		hero.createEl('button', { text: s.runSetupAgain }).addEventListener('click', () => void this.plugin.openSetup());

		new Setting(containerEl).setName(s.folders).setDesc(s.foldersNote).setHeading();
		this.folder(containerEl, 'matters', s.mattersFolder, s.mattersFolderDesc);
		this.folder(containerEl, 'actions', s.actionsFolder, s.actionsFolderDesc);
		this.folder(containerEl, 'boards', s.boardsFolder, s.boardsFolderDesc);
		this.folder(containerEl, 'people', s.peopleFolder, s.peopleFolderDesc);

		new Setting(containerEl).setName(s.board).setHeading();
		new Setting(containerEl)
			.setName(s.inboxLane)
			.setDesc(s.inboxLaneDesc)
			.addDropdown((d) =>
				d
					.addOption('top', STRINGS.views.options.first)
					.addOption('bottom', STRINGS.views.options.last)
					.setValue(this.plugin.settings.defaultInboxPosition)
					.onChange((v) => this.save({ defaultInboxPosition: v === 'bottom' ? 'bottom' : 'top' })),
			);
		new Setting(containerEl)
			.setName(s.showDone)
			.setDesc(s.showDoneDesc)
			.addToggle((t) => t.setValue(this.plugin.settings.showDone).onChange((v) => this.save({ showDone: v })));
		new Setting(containerEl)
			.setName(s.weekStart)
			.setDesc(s.weekStartDesc)
			.addDropdown((d) =>
				d
					.addOption('monday', s.monday)
					.addOption('sunday', s.sunday)
					.setValue(this.plugin.settings.weekStart)
					.onChange((v) => this.save({ weekStart: v === 'sunday' ? 'sunday' : 'monday' })),
			);

		new Setting(containerEl).setName(s.statuses).setHeading();
		this.statusEditor = new StatusEditor(containerEl.createDiv(), {
			statuses: this.plugin.settings.statuses,
			onChange: (statuses) => {
				this.plugin.settings.statuses = statuses;
				this.saveSoon();
			},
			onDelete: (status) => this.deleteStatus(status),
		});

		new Setting(containerEl).setName(s.types).setHeading();
		this.typeEditor = new TypeEditor(this.app, containerEl.createDiv(), {
			types: this.plugin.settings.types,
			onChange: (types) => {
				this.plugin.settings.types = types;
				this.saveSoon();
			},
			onDelete: (type) => this.deleteType(type),
		});
	}

	hide(): void {
		// Flush a pending label edit before the tab closes.
		this.saveSoon.run();
	}

	private folder(containerEl: HTMLElement, key: FolderKey, name: string, desc: string): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((t) =>
				t.setValue(this.plugin.settings.folders[key]).onChange((value) => {
					const path = normalizePath(value.trim());
					if (!path || path === '/') return;
					this.plugin.settings.folders[key] = path;
					this.saveSoon();
				}),
			);
	}

	private save(patch: Partial<MattersSettings>): void {
		Object.assign(this.plugin.settings, patch);
		void this.plugin.saveSettings();
	}

	private deleteStatus(status: StatusDef): void {
		const statuses = this.plugin.settings.statuses;
		const files = actionsUsing(this.app, 'mtm-status', status.id);
		new DeleteModal(this.app, {
			kind: 'status',
			label: status.label,
			count: files.length,
			preselect: backlogStatus(statuses)?.id ?? '',
			destinations: statuses
				.filter((s) => s.id !== status.id)
				.map((s) => ({ id: s.id, render: (el: HTMLElement) => void statusChip(el, s) })),
			onConfirm: async (destId) => {
				const dest = statuses.find((s) => s.id === destId);
				if (files.length && dest) new Notice(STRINGS.notices.moved(await moveStatus(this.app, files, status, dest)));
				this.plugin.settings.statuses = this.plugin.settings.statuses.filter((s) => s.id !== status.id);
				await this.plugin.saveSettings();
				this.statusEditor?.set(this.plugin.settings.statuses);
			},
		}).open();
	}

	private deleteType(type: TypeDef): void {
		const types = this.plugin.settings.types;
		const files = actionsUsing(this.app, 'mtm-type', type.id);
		new DeleteModal(this.app, {
			kind: 'type',
			label: type.label,
			count: files.length,
			preselect: defaultType(types)?.id ?? '',
			destinations: types
				.filter((t) => t.id !== type.id)
				.map((t) => ({
					id: t.id,
					classes: typeClasses(t),
					render: (el: HTMLElement) => {
						tileEl(el, t.icon, 'mod-sm');
						el.appendText(t.label);
					},
				})),
			onConfirm: async (destId) => {
				if (files.length) new Notice(STRINGS.notices.moved(await moveType(this.app, files, destId)));
				this.plugin.settings.types = this.plugin.settings.types.filter((t) => t.id !== type.id);
				await this.plugin.saveSettings();
				this.typeEditor?.set(this.plugin.settings.types);
			},
		}).open();
	}
}
