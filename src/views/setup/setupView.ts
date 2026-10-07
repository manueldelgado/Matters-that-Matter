// Setup wizard: an ItemView opened in a tab. Nothing is written before "Create".

import { ItemView, normalizePath, Notice, type WorkspaceLeaf } from 'obsidian';
import type MattersPlugin from '../../main';
import { DEFAULT_SETTINGS } from '../../settings';
import { STRINGS } from '../../strings';
import { boardBaseContent } from '../../services/baseFile';
import { matchPreset } from '../../services/presets';
import { planSetup, type SetupPlan } from '../../services/setupPlan';
import { appendIcon } from '../../ui/components/dom';
import { alwaysUpdateLinks, ensureDateTimeTypes, openSettingsTab } from '../../vault/internal';
import { exists, frontmatterOf, maxLaneOrder } from '../../vault/notes';
import { executePlan } from '../../vault/setupRunner';
import { renderLocation, renderMatters, renderSummary, renderWorkflow, ruleMatches, type SetupState } from './setupSteps';

export const VIEW_SETUP = 'mtm-setup';

const STEP_COUNT = 4;

export class SetupView extends ItemView {
	private step = 1;
	private state: SetupState;
	private running = false;

	constructor(leaf: WorkspaceLeaf, private plugin: MattersPlugin) {
		super(leaf);
		this.state = this.initialState();
	}

	getViewType(): string {
		return VIEW_SETUP;
	}

	getDisplayText(): string {
		return STRINGS.views.setup;
	}

	getIcon(): string {
		return 'sparkles';
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/** Starts from the current settings, so running setup again keeps the workflow. */
	private initialState(): SetupState {
		const settings = this.plugin.settings;
		const statuses = structuredClone(settings.statuses);
		return {
			folders: { ...settings.folders },
			statuses,
			preset: matchPreset(statuses),
			newMatters: '',
			adoptPicked: new Set(),
			adoptQuery: '',
			rule: { mode: 'folder', value: '' },
			sample: false,
		};
	}

	private cleanFolders(): void {
		const folders = this.state.folders;
		for (const key of Object.keys(folders) as (keyof typeof folders)[]) {
			const path = normalizePath(folders[key].trim());
			folders[key] = path && path !== '/' ? path : DEFAULT_SETTINGS.folders[key];
		}
	}

	private plan(): SetupPlan {
		const { app } = this;
		const settings = this.plugin.settings;
		const adopt = new Set(this.state.adoptPicked);
		for (const file of ruleMatches(app, this.state.rule)) adopt.add(file.path);
		return planSetup(
			{
				folders: this.state.folders,
				statuses: this.state.statuses,
				types: settings.types,
				newMatters: this.state.newMatters,
				adopt: [...adopt],
				sample: this.state.sample,
				inboxPath: settings.inboxPath,
				boardPath: settings.boardPath,
				baseContent: boardBaseContent(STRINGS.views),
				now: new Date(),
			},
			{
				exists: (path) => exists(app, path),
				isMatter: (path) => {
					const file = app.vault.getFileByPath(normalizePath(path));
					return !!file && frontmatterOf(app, file)?.['mtm-kind'] === 'matter';
				},
				maxLaneOrder: maxLaneOrder(app),
			},
		);
	}

	private go(step: number): void {
		if (this.step === 1) this.cleanFolders();
		this.step = Math.max(1, Math.min(STEP_COUNT, step));
		this.render();
	}

	private render(): void {
		const s = STRINGS.setup;
		const root = this.contentEl;
		root.empty();
		const inner = root.createDiv({ cls: 'mtm-setup' }).createDiv({ cls: 'mtm-setup-inner' });

		const progress = inner.createDiv({ cls: 'mtm-setup-progress' });
		s.steps.forEach((label, i) => {
			const n = i + 1;
			const step = progress.createSpan({ cls: 'mtm-setup-step' });
			if (n < this.step) step.addClass('is-done');
			if (n === this.step) step.addClass('is-current');
			const num = step.createSpan({ cls: 'mtm-setup-step-num' });
			if (n < this.step) appendIcon(num, 'check');
			else num.setText(String(n));
			step.appendText(label);
		});

		const card = inner.createDiv({ cls: 'mtm-setup-card' });
		const head = card.createDiv({ cls: 'mtm-setup-head' });
		head.createDiv({ cls: 'mtm-setup-eyebrow', text: s.stepOf(this.step, STEP_COUNT) });
		const [title, lead] = (
			[
				[s.location.title, s.location.lead],
				[s.workflow.title, s.workflow.lead],
				[s.matters.title, s.matters.lead],
				[s.summary.title, s.summary.lead],
			] as const
		)[this.step - 1] ?? ['', ''];
		head.createEl('h2', { cls: 'mtm-setup-title', text: title });
		head.createEl('p', { cls: 'mtm-setup-lead', text: lead });

		const body = card.createDiv({ cls: 'mtm-setup-body' });
		if (this.step === 1) renderLocation(this.app, body, this.state);
		else if (this.step === 2) renderWorkflow(body, this.state);
		else if (this.step === 3) renderMatters(this.app, body, this.state);
		else
			renderSummary(
				body,
				this.state,
				this.plan(),
				{
					linksOff: alwaysUpdateLinks(this.app) === false,
					basesOff: !this.plugin.basesAvailable,
					openFilesAndLinks: () => openSettingsTab(this.app, 'file'),
				},
				() => this.render(),
			);

		const footer = card.createDiv({ cls: 'mtm-setup-footer' });
		if (this.step > 1) footer.createEl('button', { text: s.back }).addEventListener('click', () => this.go(this.step - 1));
		else footer.createSpan({ cls: 'mtm-setup-footer-note', text: s.footerNote });
		footer.createSpan({ cls: 'mtm-spacer' });
		if (this.step < STEP_COUNT) {
			footer.createEl('button', { cls: 'mod-cta', text: s.next }).addEventListener('click', () => this.go(this.step + 1));
		} else {
			const create = footer.createEl('button', { cls: 'mtm-button-done' });
			appendIcon(create, 'sparkles');
			create.appendText(this.running ? s.creating : s.create);
			create.disabled = this.running;
			create.addEventListener('click', () => void this.create());
		}
	}

	private async create(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.render();
		const plan = this.plan();
		try {
			await executePlan(this.app, plan);
			ensureDateTimeTypes(this.app);
			Object.assign(this.plugin.settings, {
				folders: { ...this.state.folders },
				statuses: this.state.statuses,
				inboxPath: plan.inboxPath,
				boardPath: plan.boardPath,
				setupDone: true,
			});
			await this.plugin.saveSettings();
			new Notice(STRINGS.notices.setupDone);
			await this.plugin.openBoard();
			this.leaf.detach();
		} catch (e) {
			console.error('Matters that Matter: setup failed', e);
			new Notice(STRINGS.notices.setupFailed(e instanceof Error ? e.message : String(e)));
			this.running = false;
			this.render();
		}
	}
}
