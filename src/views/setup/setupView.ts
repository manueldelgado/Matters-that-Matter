// Setup wizard: an ItemView opened in a tab. Nothing is written before "Create".

import { ItemView, normalizePath, Notice, type WorkspaceLeaf } from 'obsidian';
import type MattersPlugin from '../../main';
import { DEFAULT_SETTINGS } from '../../settings';
import { STRINGS } from '../../strings';
import { boardBaseContent } from '../../services/baseFile';
import { matchPreset, workflowLosses, type WorkflowLosses } from '../../services/presets';
import { needsReconnect, putBack, recognise, type Reconnect } from '../../services/reconnect';
import { planSetup, type SetupPlan } from '../../services/setupPlan';
import { SAMPLE_SPHERES, withSampleSpheres } from '../../services/samplePackage';
import { appendIcon, tileEl } from '../../ui/components/dom';
import { companionThemeActive, renderThemeOffer } from '../../ui/components/themeOffer';
import { alwaysUpdateLinks, ensureDateTimeTypes, openSettingsTab } from '../../vault/internal';
import { exists, frontmatterOf, maxLaneOrder, notesOfKind } from '../../vault/notes';
import { scanVault } from '../../vault/reconnectScan';
import { executePlan } from '../../vault/setupRunner';
import { renderLocation, renderMatters, renderSummary, renderWorkflow, ruleMatches, type SetupState } from './setupSteps';

export const VIEW_SETUP = 'mtm-setup';

const STEP_COUNT = 4;

export class SetupView extends ItemView {
	private step = 1;
	private state: SetupState;
	private running = false;
	/** Opened without settings: settings arriving from sync meanwhile end it. */
	private readonly firstRun: boolean;
	private arrived = false;
	/** The user has typed or moved on: a later scan no longer replaces what's on screen. */
	private touched = false;

	constructor(leaf: WorkspaceLeaf, private plugin: MattersPlugin) {
		super(leaf);
		this.firstRun = !plugin.settings.setupDone;
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
		this.contentEl.addEventListener('input', () => (this.touched = true));
		if (this.firstRun) {
			// Settings from another device: setup steps aside rather than overwrite them.
			this.registerEvent(
				this.plugin.events.on('settings-changed', (external: unknown) => {
					if (external !== true || !this.plugin.settings.setupDone || this.arrived) return;
					this.arrived = true;
					this.render();
				}),
			);
			await this.scan();
			// A vault still being indexed: look again once Obsidian has read every note.
			this.registerEvent(this.app.metadataCache.on('resolved', () => void this.scan()));
		}
		// The theme card follows the theme: installing Calm Matters from its button turns it into a confirmation.
		let themeActive = companionThemeActive(this.app);
		this.registerEvent(
			this.app.workspace.on('css-change', () => {
				const now = companionThemeActive(this.app);
				if (now === themeActive) return;
				themeActive = now;
				if (this.step === STEP_COUNT) this.render();
			}),
		);
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/** Without settings, on a vault with MTM notes: read them back (reconnect mode). */
	private async scan(): Promise<void> {
		if (this.touched || this.step !== 1 || this.arrived || this.running) return;
		const scan = await scanVault(this.app);
		if (this.touched || this.step !== 1) return;
		const was = this.state.reconnect;
		if (!needsReconnect(scan, DEFAULT_SETTINGS.inboxPath)) {
			if (!was) return;
			this.state = this.initialState();
		} else this.state = this.reconnectState(recognise(scan, DEFAULT_SETTINGS));
		this.render();
	}

	private reconnectState(r: Reconnect): SetupState {
		return {
			...this.initialState(),
			folders: { ...r.folders },
			statuses: structuredClone(r.statuses),
			types: structuredClone(r.types),
			spheres: structuredClone(r.spheres),
			preset: r.preset ?? 'found',
			reconnect: r,
			generated: { statuses: new Set(r.generated.statuses), types: new Set(r.generated.types), spheres: new Set(r.generated.spheres) },
		};
	}

	/** Leaves reconnect mode for a setup from the defaults. */
	private startFresh(): void {
		this.touched = true;
		this.state = this.initialState();
		this.step = 1;
		this.render();
	}

	/** Starts from the current settings, so running setup again keeps the workflow. */
	private initialState(): SetupState {
		const settings = this.plugin.settings;
		const statuses = structuredClone(settings.statuses);
		return {
			folders: { ...settings.folders },
			statuses,
			types: structuredClone(settings.types),
			preset: matchPreset(statuses),
			spheres: null,
			reconnect: null,
			generated: { statuses: new Set(), types: new Set(), spheres: new Set() },
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
				types: this.state.types,
				newMatters: this.state.newMatters,
				adopt: [...adopt],
				sample: this.state.sample && !this.state.reconnect?.sample,
				inboxPath: this.state.reconnect?.inboxPath ?? settings.inboxPath,
				boardPath: this.state.reconnect?.boardPath ?? settings.boardPath,
				baseContent: boardBaseContent(STRINGS.views),
				now: new Date(),
			},
			{
				exists: (path) => exists(app, path),
				isMatter: (path) => {
					const file = app.vault.getFileByPath(normalizePath(path));
					return !!file && frontmatterOf(app, file)?.['mtm-kind'] === 'matter';
				},
				isOtherKind: (path) => {
					const file = app.vault.getFileByPath(normalizePath(path));
					const kind = file ? frontmatterOf(app, file)?.['mtm-kind'] : undefined;
					return kind !== undefined && kind !== 'matter';
				},
				maxLaneOrder: maxLaneOrder(app),
			},
		);
	}

	/** Statuses and types the notes use that the chosen workflow lacks: their Actions would show badges. */
	private losses(): WorkflowLosses {
		const { app } = this;
		const settings = this.plugin.settings;
		const actions = notesOfKind(app, 'action').map((file) => {
			const fm = frontmatterOf(app, file);
			return { status: fm?.['mtm-status'], type: fm?.['mtm-type'] };
		});
		const r = this.state.reconnect;
		return workflowLosses(actions, { statuses: this.state.statuses, types: this.state.types }, r ? [r, settings] : [settings]);
	}

	private go(step: number): void {
		this.touched = true;
		if (this.step === 1) this.cleanFolders();
		this.step = Math.max(1, Math.min(STEP_COUNT, step));
		this.render();
	}

	private render(): void {
		const s = STRINGS.setup, rc = s.reconnect;
		const r = this.state.reconnect;
		const root = this.contentEl;
		root.empty();
		const inner = root.createDiv({ cls: 'mtm-setup' }).createDiv({ cls: 'mtm-setup-inner' });
		if (this.arrived) {
			this.renderArrived(inner);
			return;
		}

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
		const eyebrow = head.createDiv({ cls: 'mtm-setup-eyebrow', text: s.stepOf(this.step, STEP_COUNT) });
		if (r) {
			const mode = eyebrow.createSpan({ cls: 'mtm-setup-mode' });
			appendIcon(mode, 'plug');
			mode.appendText(rc.mode);
		}
		const [title, lead] = (
			[
				r ? [rc.location.title, rc.location.lead(r.actionCount, r.matterCount)] : [s.location.title, s.location.lead],
				[s.workflow.title, r ? rc.workflow.lead : s.workflow.lead],
				[s.matters.title, r ? rc.matters.lead : s.matters.lead],
				[s.summary.title, r ? rc.summary.lead : s.summary.lead],
			] as const
		)[this.step - 1] ?? ['', ''];
		head.createEl('h2', { cls: 'mtm-setup-title', text: title });
		head.createEl('p', { cls: 'mtm-setup-lead', text: lead });

		const body = card.createDiv({ cls: 'mtm-setup-body' });
		if (this.step === 1) renderLocation(this.app, body, this.state, { startFresh: () => this.startFresh() });
		else if (this.step === 2) renderWorkflow(this.app, body, this.state);
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
					losses: this.losses(),
					newSpheres: SAMPLE_SPHERES.filter((s) => !(this.state.spheres ?? this.plugin.settings.spheres).some((x) => x.id === s.id)).map((s) => s.label),
					putBack: () => {
						if (!r) return;
						const lost = this.losses();
						this.state.statuses = putBack(this.state.statuses, r.statuses, lost.statuses.map((l) => l.id));
						this.state.types = putBack(this.state.types, r.types, lost.types.map((l) => l.id));
						this.render();
					},
					keepWorkflow: () => {
						const settings = this.plugin.settings;
						this.state.statuses = structuredClone(settings.statuses);
						this.state.types = structuredClone(settings.types);
						this.state.preset = matchPreset(this.state.statuses);
						this.render();
					},
				},
				() => this.render(),
			);
		// Last on the Summary step, right above Create.
		if (this.step === STEP_COUNT) renderThemeOffer(body, this.app);

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

	/** Settings arrived from another device while setup was open: nothing to do here. */
	private renderArrived(inner: HTMLElement): void {
		const a = STRINGS.setup.reconnect.arrived;
		const box = inner.createDiv({ cls: 'mtm-setup-card' }).createDiv({ cls: 'mtm-setup-arrived' });
		tileEl(box, 'refresh-cw', 'mod-lg mod-neutral');
		box.createEl('h2', { cls: 'mtm-setup-title', text: a.title });
		box.createEl('p', { cls: 'mtm-setup-lead', text: a.text });
		box.createEl('button', { cls: 'mod-cta', text: a.openBoard }).addEventListener('click', () => {
			void this.plugin.openBoard();
			this.leaf.detach();
		});
	}

	private async create(): Promise<void> {
		if (this.running) return;
		// Settings arrived meanwhile: writing ours would overwrite them on every device.
		if (this.firstRun && this.plugin.settings.setupDone) {
			this.arrived = true;
			this.render();
			return;
		}
		this.running = true;
		this.render();
		const plan = this.plan();
		try {
			// Before any note exists: Obsidian would otherwise type the dates from the first date-only value it sees.
			ensureDateTimeTypes(this.app);
			await executePlan(this.app, plan);
			Object.assign(this.plugin.settings, {
				folders: { ...this.state.folders },
				statuses: this.state.statuses,
				types: this.state.types,
				inboxPath: plan.inboxPath,
				boardPath: plan.boardPath,
				// Reconnecting brings Spheres back; the sample's Matters sit in its Spheres.
				spheres: ((spheres) => (plan.create.some((n) => n.sample) ? withSampleSpheres(spheres) : spheres))(this.state.spheres ?? this.plugin.settings.spheres),
				setupDone: true,
			});
			await this.plugin.saveSettings();
			this.plugin.onSetupDone();
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
