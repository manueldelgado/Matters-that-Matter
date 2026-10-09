// The four steps of the setup wizard. Each renders into the card body and edits the shared state.

import { getAllTags, normalizePath, prepareFuzzySearch, TFile, TFolder, type App } from 'obsidian';
import type { StatusDef, TypeDef } from '../../settings';
import { STRINGS } from '../../strings';
import { areContexts, matchPreset, PRESET_IDS, presetStatuses, presetTypes, type PresetId, type WorkflowLosses } from '../../services/presets';
import { SAMPLE_COUNTS, SAMPLE_FOLDER } from '../../services/samplePackage';
import type { Folders, SetupPlan } from '../../services/setupPlan';
import { appendIcon, statusChip, tileEl, typeClasses } from '../../ui/components/dom';
import { StatusEditor } from '../../ui/components/statusEditor';
import { frontmatterOf } from '../../vault/notes';

export interface SetupState {
	folders: Folders;
	statuses: StatusDef[];
	/** The types the workflow brings: the current ones until a preset is chosen. */
	types: TypeDef[];
	preset: PresetId;
	newMatters: string;
	adoptPicked: Set<string>;
	adoptQuery: string;
	rule: { mode: 'folder' | 'tag'; value: string };
	sample: boolean;
}

const MAX_RESULTS = 50;

function field(parent: HTMLElement, label: string, aside?: string): HTMLElement {
	const el = parent.createDiv({ cls: 'mtm-field' });
	const labelEl = el.createDiv({ cls: 'mtm-label', text: label });
	if (aside) labelEl.createSpan({ cls: 'mtm-label-aside', text: aside });
	return el;
}

// ——— 1. Location ———

export function renderLocation(app: App, body: HTMLElement, state: SetupState): void {
	const s = STRINGS.settings, h = STRINGS.setup.location;
	const rows: [keyof Folders, string, string][] = [
		['matters', s.mattersFolder, h.mattersHint],
		['actions', s.actionsFolder, h.actionsHint],
		['boards', s.boardsFolder, h.boardsHint],
		['people', s.peopleFolder, h.peopleHint],
	];
	for (const [key, label, hint] of rows) {
		const exists = app.vault.getAbstractFileByPath(normalizePath(state.folders[key])) instanceof TFolder;
		const el = field(body, label, exists ? h.exists : undefined);
		const wrap = el.createDiv({ cls: 'mtm-input-icon' });
		appendIcon(wrap, 'folder');
		const input = wrap.createEl('input', { type: 'text', value: state.folders[key] });
		input.addEventListener('input', () => (state.folders[key] = input.value));
		el.createSpan({ cls: 'mtm-field-hint', text: hint });
	}
}

// ——— 2. Workflow ———

/** The types the workflow brings, read-only: setup has no type step. */
function renderTypeSummary(parent: HTMLElement, types: readonly TypeDef[]): void {
	const w = STRINGS.setup.workflow;
	parent.empty();
	parent.createDiv({ cls: 'mtm-label', text: w.types }).createSpan({ cls: 'mtm-label-aside', text: w.typesAside });
	const row = parent.createDiv({ cls: 'mtm-type-summary' });
	for (const type of types) {
		const token = row.createSpan({ cls: ['mtm-token', ...typeClasses(type)] });
		tileEl(token, type.icon);
		token.appendText(type.label);
		if (type.default) token.createSpan({ cls: 'mtm-default-badge', text: STRINGS.editors.default });
	}
	const first = types[0];
	const hint = areContexts(types) ? w.contextsHint(first?.id ?? '', types[2]?.id ?? '') : first ? w.typesHint(first.id) : null;
	if (hint) parent.createSpan({ cls: 'mtm-field-hint', text: hint });
}

export function renderWorkflow(body: HTMLElement, state: SetupState): void {
	const w = STRINGS.setup.workflow;
	const presets = body.createDiv({ cls: ['mtm-presets', 'mod-pairs'] });
	const renderPresets = () => {
		presets.empty();
		for (const id of PRESET_IDS as PresetId[]) {
			const [title, desc] = w.presets[id];
			const card = presets.createDiv({ cls: 'mtm-preset', attr: { role: 'radio', 'aria-checked': String(state.preset === id), tabindex: 0 } });
			const titleEl = card.createSpan({ cls: 'mtm-preset-title', text: title });
			if (state.preset === id) {
				card.addClass('is-active');
				appendIcon(titleEl, 'circle-check');
			}
			const dots = card.createSpan({ cls: 'mtm-preset-statuses' });
			for (const status of id === 'custom' ? state.statuses : presetStatuses(id)) statusChip(dots, status, false);
			if (id === 'next') {
				const tiles = card.createSpan({ cls: 'mtm-preset-types' });
				for (const type of presetTypes(id)) tileEl(tiles, type.icon).addClasses(typeClasses(type));
			}
			card.createSpan({ cls: 'mtm-preset-desc', text: desc });
			const choose = () => {
				state.preset = id;
				// Custom keeps the statuses as edited and the types of the last preset chosen.
				if (id !== 'custom') {
					state.statuses = presetStatuses(id);
					state.types = presetTypes(id);
					editor.set(state.statuses);
					renderTypeSummary(typesField, state.types);
				}
				renderPresets();
			};
			card.addEventListener('click', choose);
			card.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					choose();
				}
			});
		}
	};

	const statusesField = field(body, w.statuses, STRINGS.editors.dragHint);
	const editor = new StatusEditor(statusesField, {
		statuses: state.statuses,
		onChange: (statuses) => {
			state.statuses = statuses;
			state.preset = matchPreset(statuses);
			renderPresets();
		},
		onDelete: (status) => {
			state.statuses = state.statuses.filter((s) => s.id !== status.id);
			state.preset = 'custom';
			editor.set(state.statuses);
			renderPresets();
		},
	});
	const typesField = body.createDiv({ cls: 'mtm-field' });
	renderTypeSummary(typesField, state.types);
	renderPresets();
}

// ——— 3. Matters ———

/** Notes that can be adopted: Markdown notes without an mtm-kind. */
function adoptable(app: App): TFile[] {
	return app.vault.getMarkdownFiles().filter((f) => frontmatterOf(app, f)?.['mtm-kind'] === undefined);
}

export function ruleMatches(app: App, rule: SetupState['rule']): TFile[] {
	const value = rule.value.trim().replace(/^#/, '').replace(/\/+$/, '');
	if (!value) return [];
	if (rule.mode === 'folder') {
		const prefix = `${normalizePath(value)}/`;
		return adoptable(app).filter((f) => f.path.startsWith(prefix));
	}
	const tag = `#${value.toLowerCase()}`;
	return adoptable(app).filter((f) => {
		const cache = app.metadataCache.getFileCache(f);
		return !!cache && (getAllTags(cache) ?? []).some((t) => t.toLowerCase() === tag || t.toLowerCase().startsWith(`${tag}/`));
	});
}

/** Highlights matched ranges with `mark.mtm-match`. */
function highlighted(parent: HTMLElement, text: string, matches: [number, number][]): void {
	let pos = 0;
	for (const [start, end] of matches) {
		parent.appendText(text.slice(pos, start));
		parent.createEl('mark', { cls: 'mtm-match', text: text.slice(start, end) });
		pos = end;
	}
	parent.appendText(text.slice(pos));
}

export function renderMatters(app: App, body: HTMLElement, state: SetupState): void {
	const m = STRINGS.setup.matters;

	const newField = field(body, m.newMatters);
	const textarea = newField.createEl('textarea', { cls: 'mtm-textarea' });
	textarea.value = state.newMatters;
	textarea.addEventListener('input', () => (state.newMatters = textarea.value));
	newField.createSpan({ cls: 'mtm-field-hint', text: m.newMattersHint });

	const adoptField = field(body, m.adopt, m.selected(state.adoptPicked.size));
	const aside = adoptField.querySelector<HTMLElement>('.mtm-label-aside');
	const search = adoptField.createDiv({ cls: 'mtm-input-icon' });
	appendIcon(search, 'search');
	const input = search.createEl('input', { type: 'text', value: state.adoptQuery, attr: { placeholder: m.search } });
	const list = adoptField.createDiv({ cls: 'mtm-adopt-list' });
	const candidates = adoptable(app);

	const renderList = () => {
		list.empty();
		const query = state.adoptQuery.trim();
		const picked = candidates.filter((f) => state.adoptPicked.has(f.path));
		let results: { file: TFile; matches: [number, number][] }[] = picked.map((file) => ({ file, matches: [] }));
		if (query) {
			const fuzzy = prepareFuzzySearch(query);
			results = results.concat(
				candidates
					.filter((f) => !state.adoptPicked.has(f.path))
					.map((file) => ({ file, result: fuzzy(file.basename) }))
					.filter((r) => r.result !== null)
					.sort((a, b) => (b.result?.score ?? 0) - (a.result?.score ?? 0))
					.slice(0, MAX_RESULTS)
					.map((r) => ({ file: r.file, matches: r.result?.matches ?? [] })),
			);
		}
		if (!results.length && query) list.createDiv({ cls: 'mtm-adopt-item', text: m.noResults });
		for (const { file, matches } of results) {
			const item = list.createEl('label', { cls: 'mtm-adopt-item' });
			const box = item.createEl('input', { type: 'checkbox' });
			box.checked = state.adoptPicked.has(file.path);
			item.toggleClass('is-checked', box.checked);
			appendIcon(item, 'file-text');
			highlighted(item.createSpan({ cls: 'mtm-adopt-name' }), file.basename, matches);
			item.createSpan({ cls: 'mtm-adopt-path', text: file.parent?.path === '/' ? '' : `${file.parent?.path ?? ''}/` });
			box.addEventListener('change', () => {
				if (box.checked) state.adoptPicked.add(file.path);
				else state.adoptPicked.delete(file.path);
				item.toggleClass('is-checked', box.checked);
				aside?.setText(m.selected(state.adoptPicked.size));
			});
		}
		list.toggle(results.length > 0 || !!query);
	};
	input.addEventListener('input', () => {
		state.adoptQuery = input.value;
		renderList();
	});
	renderList();

	const ruleField = field(body, m.byRule);
	const row = ruleField.createDiv({ cls: 'mtm-rule-row' });
	row.appendText(m.everyNoteIn);
	const select = row.createEl('select', { cls: 'dropdown' });
	select.createEl('option', { value: 'folder', text: m.inFolder });
	select.createEl('option', { value: 'tag', text: m.withTag });
	select.value = state.rule.mode;
	const ruleInput = row.createEl('input', { type: 'text', value: state.rule.value });
	const count = row.createSpan({ cls: 'mtm-rule-count' });
	const updateCount = () => {
		const n = ruleMatches(app, state.rule).length;
		count.setText(m.ruleCount(n));
		count.toggle(!!state.rule.value.trim());
	};
	select.addEventListener('change', () => {
		state.rule.mode = select.value === 'tag' ? 'tag' : 'folder';
		updateCount();
	});
	ruleInput.addEventListener('input', () => {
		state.rule.value = ruleInput.value;
		updateCount();
	});
	updateCount();
}

// ——— 4. Summary ———

export interface SummaryWarnings {
	linksOff: boolean;
	basesOff: boolean;
	openFilesAndLinks(): void;
	/** Actions that would use a status or type the chosen workflow lacks (running setup again). */
	losses: WorkflowLosses;
	keepWorkflow(): void;
	/** Labels of the sample's Spheres that settings will gain. */
	newSpheres: string[];
}

function summaryItem(list: HTMLElement, cls: string | null, icon: string, path: string, note: string): void {
	const item = list.createDiv({ cls: cls ? `mtm-summary-item ${cls}` : 'mtm-summary-item' });
	appendIcon(item, icon);
	item.createSpan({ cls: 'mtm-summary-path', text: path });
	item.createSpan({ cls: 'mtm-summary-note', text: note });
}

export function renderSummary(body: HTMLElement, state: SetupState, plan: SetupPlan, warnings: SummaryWarnings, onSample: () => void): void {
	const t = STRINGS.setup.summary;
	const summary = body.createDiv({ cls: 'mtm-summary' });

	// The sample is one line: its folders and files are listed together.
	const hasSample = plan.create.some((n) => n.sample);
	const folders = plan.folders.filter((f) => !hasSample || (f !== SAMPLE_FOLDER && !f.startsWith(`${SAMPLE_FOLDER}/`)));
	const createCount = folders.length + plan.create.filter((n) => !n.sample).length + (hasSample ? 1 : 0);
	if (createCount) {
		const group = summary.createDiv();
		group.createDiv({ cls: 'mtm-summary-group-title', text: t.create(createCount) });
		const list = group.createDiv({ cls: 'mtm-summary-list' });
		for (const folder of folders) summaryItem(list, 'mod-create', 'folder-plus', `${folder}/`, t.newFolder);
		for (const note of plan.create) if (!note.sample) summaryItem(list, 'mod-create', 'file-plus', note.path, t.newNote);
		if (hasSample) summaryItem(list, 'mod-create', 'package-plus', `${SAMPLE_FOLDER}/`, t.sampleContents(SAMPLE_COUNTS));
	}
	const spheres = state.sample ? warnings.newSpheres : [];
	if (plan.modify.length || spheres.length) {
		const group = summary.createDiv();
		group.createDiv({ cls: 'mtm-summary-group-title', text: t.modify(plan.modify.length + (spheres.length ? 1 : 0)) });
		const list = group.createDiv({ cls: 'mtm-summary-list' });
		for (const change of plan.modify) summaryItem(list, 'mod-modify', 'file-pen', change.path, t.addsKind);
		if (spheres.length) summaryItem(list, 'mod-modify', 'settings', t.settings, t.addsSpheres(spheres));
	}
	if (plan.reuse.length) {
		const group = summary.createDiv();
		group.createDiv({ cls: 'mtm-summary-group-title', text: t.reuse(plan.reuse.length) });
		const list = group.createDiv({ cls: 'mtm-summary-list' });
		for (const path of plan.reuse) summaryItem(list, null, 'file-check', path, t.exists);
	}

	const check = summary.createEl('label', { cls: 'mtm-check-row' });
	const box = check.createEl('input', { type: 'checkbox' });
	box.checked = state.sample;
	const text = check.createSpan({ text: t.sample });
	text.createEl('small', { text: t.sampleHint });
	box.addEventListener('change', () => {
		state.sample = box.checked;
		onSample();
	});

	const { losses } = warnings;
	if (losses.actions) {
		const notice = summary.createDiv({ cls: 'mtm-notice mod-warning' });
		appendIcon(notice, 'triangle-alert');
		const div = notice.createDiv();
		div.createEl('b', { text: t.lossesTitle(losses.actions) });
		const list = [...losses.statuses, ...losses.types].map((l) => `${l.label} (${l.count})`).join(', ');
		const total = [...losses.statuses, ...losses.types].reduce((n, l) => n + l.count, 0);
		div.appendText(` ${t.losses(list, total > losses.actions)}`);
		div.createDiv({ cls: 'mtm-notice-actions' })
			.createEl('button', { text: t.keepWorkflow })
			.addEventListener('click', () => warnings.keepWorkflow());
	}
	if (warnings.linksOff) {
		const notice = summary.createDiv({ cls: 'mtm-notice mod-warning' });
		appendIcon(notice, 'triangle-alert');
		const div = notice.createDiv();
		div.createEl('b', { text: t.linksOffTitle });
		div.appendText(` ${t.linksOff}`);
		div.createDiv({ cls: 'mtm-notice-actions' })
			.createEl('button', { text: t.openFilesAndLinks })
			.addEventListener('click', () => warnings.openFilesAndLinks());
	}
	if (warnings.basesOff) {
		const notice = summary.createDiv({ cls: 'mtm-notice mod-warning' });
		appendIcon(notice, 'triangle-alert');
		const div = notice.createDiv();
		div.createEl('b', { text: t.basesOffTitle });
		div.appendText(` ${t.basesOff}`);
	}
}
