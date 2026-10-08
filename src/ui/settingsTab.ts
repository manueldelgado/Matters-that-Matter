// Settings tab: folders, board defaults, and the status and type editors.
// Declarative, so Obsidian's settings search indexes every setting.

import { debounce, normalizePath, Notice, PluginSettingTab, type App, type Setting, type SettingDefinition, type SettingDefinitionItem } from 'obsidian';
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
const FOLDER_PREFIX = 'folders.';

export class MattersSettingTab extends PluginSettingTab {
	private statusEditor: StatusEditor | null = null;
	private typeEditor: TypeEditor | null = null;
	private saveSoon = debounce(() => void this.plugin.saveSettings(), 400, true);

	constructor(app: App, private plugin: MattersPlugin) {
		super(app, plugin);
		this.containerEl.addClass('mtm-settings');
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const s = STRINGS.settings;
		return [
			{ name: STRINGS.pluginName, searchable: false, render: (setting) => this.renderHero(setting) },
			{
				type: 'group',
				heading: s.folders,
				items: [
					{ name: s.folders, searchable: false, render: (setting) => { setting.setName('').setDesc(s.foldersNote); } },
					this.folder('matters', s.mattersFolder, s.mattersFolderDesc),
					this.folder('actions', s.actionsFolder, s.actionsFolderDesc),
					this.folder('boards', s.boardsFolder, s.boardsFolderDesc),
					this.folder('people', s.peopleFolder, s.peopleFolderDesc),
				],
			},
			{
				type: 'group',
				heading: s.board,
				items: [
					{
						name: s.inboxLane,
						desc: s.inboxLaneDesc,
						control: {
							type: 'dropdown',
							key: 'defaultInboxPosition',
							options: { top: STRINGS.views.options.first, bottom: STRINGS.views.options.last },
						},
					},
					{ name: s.showDone, desc: s.showDoneDesc, control: { type: 'toggle', key: 'showDone' } },
					{
						name: s.weekStart,
						desc: s.weekStartDesc,
						control: { type: 'dropdown', key: 'weekStart', options: { monday: s.monday, sunday: s.sunday } },
					},
				],
			},
			{
				type: 'group',
				heading: s.statuses,
				items: [{ name: s.statuses, desc: s.statusesDesc, aliases: [...s.statusesAliases], render: (setting) => this.renderStatuses(setting) }],
			},
			{
				type: 'group',
				heading: s.types,
				items: [{ name: s.types, desc: s.typesDesc, aliases: [...s.typesAliases], render: (setting) => this.renderTypes(setting) }],
			},
		];
	}

	getControlValue(key: string): unknown {
		if (key.startsWith(FOLDER_PREFIX)) return this.plugin.settings.folders[key.slice(FOLDER_PREFIX.length) as FolderKey];
		return this.plugin.settings[key as keyof MattersSettings];
	}

	setControlValue(key: string, value: unknown): void | Promise<void> {
		const settings = this.plugin.settings;
		if (key.startsWith(FOLDER_PREFIX)) {
			settings.folders[key.slice(FOLDER_PREFIX.length) as FolderKey] = normalizePath(String(value).trim());
			this.saveSoon();
			return;
		}
		if (key === 'defaultInboxPosition') settings.defaultInboxPosition = value === 'bottom' ? 'bottom' : 'top';
		else if (key === 'showDone') settings.showDone = value === true;
		else if (key === 'weekStart') settings.weekStart = value === 'sunday' ? 'sunday' : 'monday';
		else return;
		return this.plugin.saveSettings();
	}

	hide(): void {
		// Flush a pending edit before the tab closes.
		this.saveSoon.run();
		super.hide();
	}

	private folder(key: FolderKey, name: string, desc: string): SettingDefinition {
		return {
			name,
			desc,
			control: {
				type: 'folder',
				key: FOLDER_PREFIX + key,
				validate: (value) => {
					const path = normalizePath(value.trim());
					return !value.trim() || path === '/' ? STRINGS.settings.folderRequired : undefined;
				},
			},
		};
	}

	private renderHero(setting: Setting): void {
		setting.settingEl.empty();
		const hero = setting.settingEl.createDiv({ cls: 'mtm-settings-hero' });
		const heroText = hero.createDiv();
		heroText.createDiv({ cls: 'mtm-settings-hero-title', text: STRINGS.pluginName });
		heroText.createDiv({ cls: 'mtm-settings-hero-sub', text: STRINGS.settings.heroSub });
		hero.createSpan({ cls: 'mtm-spacer' });
		hero.createEl('button', { text: STRINGS.settings.runSetupAgain }).addEventListener('click', () => void this.plugin.openSetup());
	}

	private renderStatuses(setting: Setting): () => void {
		setting.settingEl.empty();
		this.statusEditor = new StatusEditor(setting.settingEl, {
			statuses: this.plugin.settings.statuses,
			onChange: (statuses) => {
				this.plugin.settings.statuses = statuses;
				this.saveSoon();
			},
			onDelete: (status) => this.deleteStatus(status),
		});
		return () => (this.statusEditor = null);
	}

	private renderTypes(setting: Setting): () => void {
		setting.settingEl.empty();
		this.typeEditor = new TypeEditor(this.app, setting.settingEl, {
			types: this.plugin.settings.types,
			onChange: (types) => {
				this.plugin.settings.types = types;
				this.saveSoon();
			},
			onDelete: (type) => this.deleteType(type),
		});
		return () => (this.typeEditor = null);
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
