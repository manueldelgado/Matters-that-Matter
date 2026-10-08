// Process Inbox: steps through the Inbox's open Actions, oldest first, asking "Is there something to do?".
// Processed means leaving the Inbox. Trash and Done now act at once, with Undo; the other answers open a step.

import { Modal, Notice, Scope, type TFile } from 'obsidian';
import type MattersPlugin from '../../../main';
import type { StatusDef } from '../../../settings';
import { STRINGS } from '../../../strings';
import { dayLabel, daysBetween, parseMtmDate, toYmd } from '../../../model/dates';
import { getDetails } from '../../../model/body';
import { backlogStatus, doneStatus } from '../../../model/workflow';
import type { ActionItem } from '../../../services/actionItems';
import { normalise } from '../../../services/fuzzy';
import { nextStepStatus } from '../../../services/nextAction';
import { firstName } from '../../../services/personModel';
import {
	DECISIONS,
	delegateStatus,
	inboxOrder,
	nextStatuses,
	ProcessQueue,
	tally,
	type Decision,
	type TallyEntry,
} from '../../../services/processInbox';
import { dateChipLabel } from '../../../services/quickAdd';
import { parseQuickAdd } from '../../../services/quickAddParser';
import { editAction, renameAction } from '../../../vault/actionWrites';
import { loadCandidates, type Candidates } from '../../../vault/candidates';
import { actionItem, DEFAULT_MATTER_ICON, linkedFile } from '../../../vault/index';
import { createMatter, setMatterState } from '../../../vault/matterWrites';
import { frontmatterOf, linkTo } from '../../../vault/notes';
import { defaultNoteFolder, keepAsNote, restoreTrashed, trashForUndo } from '../../../vault/processWrites';
import { avatarEl } from '../../components/card';
import { appendIcon, statusChip, swapClasses, tileEl, typeClasses } from '../../components/dom';
import { MatterSuggest } from '../../components/matterSuggest';
import { IconPickerModal } from '../iconPickerModal';
import { PersonPicker } from '../personPicker';
import { renderTypePicker } from '../quickAdd/quickAddRender';
import {
	dateField,
	destination,
	field,
	hints,
	iconInput,
	renderBar,
	renderDecisions,
	renderEnd,
	renderStepHead,
	statusSegments,
	type FiledCard,
} from './processRender';

/** How long to wait for a just-written note to be parsed. */
const PARSE_WAIT = 2000;

/** Remembers Delegate's status between sessions (on this device). */
const LAST_DELEGATE_KEY = 'mtm-process-delegate-status';

export interface ProcessInboxContext {
	/** The Sphere a board is focused on: new Matters start in it. */
	sphereId: string | null;
}

interface Current {
	file: TFile;
	item: ActionItem;
	details: string;
}

/** What the step's fields hold. */
interface Form {
	matter: string;
	statusId: string | null;
	typeId: string;
	dueText: string;
	person: TFile | null;
	somedayNew: boolean;
	name: string;
	icon: string;
	sphereId: string | null;
	firstStep: string;
	folder: string;
}

interface Undo {
	text: string;
	run(): Promise<void>;
}

export class ProcessInboxModal extends Modal {
	private queue: ProcessQueue<TFile>;
	private current: Current | null = null;
	private step: Decision | null = null;
	private form!: Form;
	private undo: Undo | null = null;
	private entries: TallyEntry[] = [];
	private filed: FiledCard[] = [];
	private candidates: Candidates;
	private busy = false;
	private itemTitleEl: HTMLElement | null = null;
	private saveStep: (() => void) | null = null;
	/** A rename from the title, still being written. */
	private renaming: Promise<void> | null = null;
	private pointerDown = false;
	/** Step values typed as tokens into the title, kept until the item is processed. */
	private pendingHints: Partial<Form> = {};

	constructor(
		private plugin: MattersPlugin,
		private context: ProcessInboxContext = { sphereId: null },
	) {
		super(plugin.app);
		const { app, settings } = plugin;
		const inbox = app.vault
			.getMarkdownFiles()
			.filter((f) => frontmatterOf(app, f)?.['mtm-kind'] === 'action')
			.map((file) => ({ file, item: actionItem(app, file, settings), title: file.basename, ctime: file.stat.ctime }))
			.filter((e) => e.item.effective.matterPath === settings.inboxPath && e.item.category !== 'closed');
		this.queue = new ProcessQueue(inboxOrder(inbox).map((e) => e.file));
		this.candidates = loadCandidates(app, settings);

		// Number keys answer, arrows move, Escape steps back before it closes.
		this.scope = new Scope(this.app.scope);
		DECISIONS.forEach((d, i) =>
			this.scope.register([], String(i + 1), () => {
				if (this.step || this.editing() || !this.current) return true;
				void this.choose(d);
				return false;
			}),
		);
		this.scope.register([], 'ArrowRight', () => this.move(1));
		this.scope.register([], 'ArrowLeft', () => this.move(-1));
		this.scope.register([], 'Escape', () => {
			if (this.itemTitleEl && activeDocument.activeElement === this.itemTitleEl) {
				this.itemTitleEl.setText(this.current?.file.basename ?? '');
				this.itemTitleEl.blur();
			} else if (this.step) this.backToQuestion();
			else this.close();
			return false;
		});
		this.scope.register([], 'Enter', (e) => {
			if (this.itemTitleEl && activeDocument.activeElement === this.itemTitleEl) {
				this.itemTitleEl.blur();
				return false;
			}
			if (!this.step || e.isComposing) return true;
			// A focused button, segment or radio keeps its own Enter (Cancel must not save).
			const el = activeDocument.activeElement;
			if (el?.instanceOf(HTMLElement) && (el.tagName === 'BUTTON' || ['button', 'radio'].includes(el.getAttribute('role') ?? ''))) return true;
			this.saveStep?.();
			return false;
		});
	}

	private get settings() {
		return this.plugin.settings;
	}

	onOpen(): void {
		this.modalEl.addClass('mtm-modal', 'mtm-process');
		this.modalEl.addEventListener('pointerdown', () => (this.pointerDown = true), true);
		this.modalEl.addEventListener('pointerup', () => (this.pointerDown = false), true);
		void this.show();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** Typing somewhere: keys belong to the field. */
	private editing(): boolean {
		const el = activeDocument.activeElement;
		return !!el?.instanceOf(HTMLElement) && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
	}

	private move(delta: 1 | -1): boolean {
		if (this.step || this.editing() || !this.current) return true;
		if (delta === 1) {
			this.undo = null;
			const next = this.queue.forward();
			if (!next) {
				this.current = null;
				this.renderEnd();
				return false;
			}
		} else this.queue.back();
		void this.show();
		return false;
	}

	// ——— Loading and rendering ———

	private async show(): Promise<void> {
		const file = this.queue.current;
		if (!file || !this.app.vault.getFileByPath(file.path)) {
			// Gone meanwhile (deleted or moved by hand): treat it as processed.
			if (file && this.queue.complete()) return this.show();
			this.current = null;
			this.renderEnd();
			return;
		}
		// Right after a write (Undo) the cache is empty until the note is parsed again; the item would fall back to defaults.
		await this.parsed(file);
		if (this.current?.file !== file) this.pendingHints = {};
		const item = actionItem(this.app, file, this.settings);
		const details = getDetails(await this.app.vault.cachedRead(file));
		this.current = { file, item, details };
		this.step = null;
		this.render();
	}

	/** Resolves once metadataCache has the note (or after a short wait). */
	private parsed(file: TFile): Promise<void> {
		const { metadataCache } = this.app;
		if (metadataCache.getFileCache(file)) return Promise.resolve();
		return new Promise((resolve) => {
			const done = () => {
				metadataCache.offref(ref);
				window.clearTimeout(timer);
				resolve();
			};
			const ref = metadataCache.on('changed', (changed) => {
				if (changed === file) done();
			});
			const timer = window.setTimeout(done, PARSE_WAIT);
		});
	}

	private render(): void {
		const current = this.current;
		if (!current) return;
		const { contentEl } = this;
		contentEl.empty();
		this.saveStep = null;
		const { type } = current.item.effective;
		swapClasses(this.modalEl, ['mtm-type-', 'mtm-tone-'], typeClasses(type));

		renderBar(contentEl, this.queue.index + 1, this.queue.total, this.queue.processed);
		if (this.undo) this.renderUndo(contentEl, this.undo);
		this.renderItem(contentEl, current);

		const footer = createDiv({ cls: 'mtm-modal-footer' });
		const p = STRINGS.process;
		if (!this.step) {
			renderDecisions(contentEl, (d) => void this.choose(d));
			hints(footer, [
				['←', p.back],
				['→', p.skip],
			]);
			footer.createEl('button', { text: p.close }).addEventListener('click', () => this.close());
		} else {
			const body = contentEl.createDiv({ cls: 'mtm-process-step' });
			const cta = this.renderStep(body, this.step, current);
			hints(footer, [['Esc', p.backToQuestion]]);
			footer.createEl('button', { text: p.cancel }).addEventListener('click', () => this.backToQuestion());
			const save = footer.createEl('button', { cls: 'mod-cta', text: cta.label });
			save.addEventListener('click', () => cta.run());
			this.saveStep = () => cta.run();
		}
		contentEl.appendChild(footer);
	}

	private renderUndo(parent: HTMLElement, undo: Undo): void {
		const notice = parent.createDiv({ cls: 'mtm-notice mod-info mtm-process-undo' });
		appendIcon(notice, 'check');
		notice.createDiv({ text: undo.text });
		const button = notice.createEl('button', { text: STRINGS.process.undo });
		button.addEventListener('click', () => {
			this.undo = null;
			void this.guard(() => undo.run());
		});
	}

	/** The item: type tile, editable title (quick add tokens fill in the step), when it was captured, its dates and people, details. */
	private renderItem(parent: HTMLElement, current: Current): void {
		const p = STRINGS.process;
		const { file, item } = current;
		const row = parent.createDiv({ cls: 'mtm-process-item' });
		tileEl(row, item.effective.type.icon, 'mod-lg');
		const main = row.createDiv({ cls: 'mtm-process-main' });
		const title = main.createDiv({
			cls: 'mtm-process-title',
			text: file.basename,
			attr: { contenteditable: 'plaintext-only', spellcheck: 'true', role: 'textbox', 'aria-label': p.titleLabel },
		});
		this.itemTitleEl = title;
		title.addEventListener('blur', () => void this.retitle(title.innerText));

		const today = toYmd(new Date());
		const captured = toYmd(new Date(file.stat.ctime));
		const meta = main.createDiv({ cls: 'mtm-process-meta' });
		appendIcon(meta, 'inbox');
		meta.createSpan({ text: p.captured(dayLabel(captured, today), daysBetween(captured, today)) });
		if (item.due) {
			const due = meta.createSpan({ cls: 'mtm-token mod-date' });
			appendIcon(due, 'calendar');
			due.appendText(dateChipLabel(item.start?.date ?? null, item.due.time ? `${item.due.date}T${item.due.time}` : item.due.date, today));
		}
		const fm = frontmatterOf(this.app, file) ?? {};
		const people = Array.isArray(fm['mtm-people']) ? (fm['mtm-people'] as unknown[]) : fm['mtm-people'] ? [fm['mtm-people']] : [];
		for (const raw of people) {
			const person = linkedFile(this.app, raw, file.path);
			if (!person) continue;
			const token = meta.createSpan({ cls: 'mtm-token mod-person' });
			avatarEl(token, person.basename);
			token.appendText(person.basename);
		}
		const open = meta.createSpan({ cls: 'mtm-process-open', attr: { role: 'button', tabindex: 0 } });
		appendIcon(open, 'file-symlink');
		open.appendText(p.openNote);
		open.addEventListener('click', () => {
			this.close();
			void this.app.workspace.getLeaf('tab').openFile(file);
		});
		if (current.details.trim()) main.createDiv({ cls: 'mtm-process-details', text: current.details.trim() });
	}

	// ——— Title tokens ———

	/** Renames to the title without tokens; the tokens prefill the step (Matter, type, due date, person). */
	private async retitle(text: string): Promise<void> {
		const current = this.current;
		if (!current) return;
		// Unchanged: nothing to do (and no re-render, which would swallow a click that caused the blur).
		if (text.trim() === current.file.basename) return;
		const result = parseQuickAdd(text, { now: new Date(), ...this.candidates, languages: this.settings.dateLanguages });
		const hint = this.formHints(result);
		if (hint) {
			this.pendingHints = { ...this.pendingHints, ...hint };
			if (this.step) Object.assign(this.form, hint);
		}
		const cleaned = result.title.trim();
		this.itemTitleEl?.setText(cleaned || current.file.basename);
		if (cleaned && cleaned !== current.file.basename) {
			this.renaming = renameAction(this.app, current.file, cleaned)
				.then(() => undefined)
				.catch((e) => {
					new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
				})
				.finally(() => (this.renaming = null));
		}
		// The step's fields show the hints; a re-render now would swallow the click that ended the edit.
		if (hint && this.step) this.renderAfterPointer();
	}

	/** Re-renders once any pressed pointer is released and its click has run. */
	private renderAfterPointer(): void {
		const run = () => window.setTimeout(() => this.current && this.render(), 0);
		if (!this.pointerDown) run();
		else activeDocument.addEventListener('pointerup', run, { once: true });
	}

	private formHints(result: ReturnType<typeof parseQuickAdd>): Partial<Form> | null {
		const hint: Partial<Form> = {};
		if (result.matterPath) {
			const matter = this.candidates.matters.find((m) => m.path === result.matterPath);
			if (matter) hint.matter = matter.name;
		}
		if (result.typeId) hint.typeId = result.typeId;
		const dateChip = result.chips.find((c) => c.kind === 'date');
		if (dateChip) hint.dueText = dateChip.text;
		const person = result.people[0] ? this.app.vault.getFileByPath(result.people[0]) : null;
		if (person) hint.person = person;
		return Object.keys(hint).length ? hint : null;
	}

	// ——— Decisions ———

	private async choose(d: Decision): Promise<void> {
		if (this.renaming) await this.renaming;
		const current = this.current;
		if (!current || this.busy) return;
		if (d === 'trash') return this.guard(() => this.trash(current));
		if (d === 'done') return this.guard(() => this.doneNow(current));
		this.undo = null;
		this.step = d;
		this.form = this.initialForm(current);
		this.render();
		this.contentEl.querySelector<HTMLInputElement>('.mtm-process-step input')?.focus();
	}

	private backToQuestion(): void {
		this.step = null;
		this.render();
	}

	private initialForm(current: Current): Form {
		const s = this.settings;
		const item = current.item;
		const matter = this.candidates.matters.find((m) => m.path === item.effective.matterPath && m.path !== s.inboxPath)?.name ?? '';
		const lastDelegate = this.app.loadLocalStorage(LAST_DELEGATE_KEY) as unknown;
		const delegate = delegateStatus(s.statuses, typeof lastDelegate === 'string' ? lastDelegate : null);
		const waiting = linkedFile(this.app, frontmatterOf(this.app, current.file)?.['mtm-waiting-on'], current.file.path);
		const form: Form = {
			matter,
			statusId: this.step === 'delegate' ? (delegate?.id ?? null) : (nextStepStatus(s.statuses)?.id ?? null),
			typeId: item.effective.type.id,
			dueText: '',
			person: waiting,
			somedayNew: false,
			name: current.file.basename,
			icon: DEFAULT_MATTER_ICON,
			sphereId: this.context.sphereId,
			firstStep: '',
			folder: defaultNoteFolder(this.app, current.file),
		};
		return { ...form, ...this.pendingHints };
	}

	/** A plain-words date, as quick add reads it; null when it isn't one. */
	private parseDate(text: string): { start: string | null; due: string } | null {
		const result = parseQuickAdd(text, { now: new Date(), types: [], matters: [], people: [], languages: this.settings.dateLanguages });
		const chip = result.chips.find((c) => c.kind === 'date');
		return chip?.kind === 'date' ? { start: chip.startDate, due: chip.due } : null;
	}

	private dateLabel = (text: string): string | null => {
		const parsed = this.parseDate(text);
		return parsed ? dateChipLabel(parsed.start, parsed.due, toYmd(new Date())) : null;
	};

	// ——— Steps ———

	/** Renders the step for a decision and returns its main button. */
	private renderStep(body: HTMLElement, d: Decision, current: Current): { label: string; run: () => void } {
		const p = STRINGS.process;
		const s = this.settings;
		const f = this.form;
		const back = () => this.backToQuestion();
		const save = (fn: () => Promise<void>) => () => void this.guard(fn);

		if (d === 'next') {
			const offered = nextStatuses(s.statuses);
			const preset = offered.find((x) => x.id === f.statusId) ?? offered[0];
			renderStepHead(body, d, preset ? p.nextHint(preset.label) : null, back);
			const grid = body.createDiv({ cls: 'mtm-field-grid' });
			this.matterField(grid.createDiv());
			statusSegments(field(grid.createDiv(), p.status), offered, preset?.id ?? null, (id) => (f.statusId = id));
			this.typeField(body);
			dateField(body, p.due, f.dueText, this.dateLabel, (t) => (f.dueText = t));
			return { label: p.saveNext, run: save(() => this.doNext(current)) };
		}

		if (d === 'delegate') {
			renderStepHead(body, d, null, back);
			this.personField(body);
			const grid = body.createDiv({ cls: 'mtm-field-grid' });
			this.matterField(grid.createDiv());
			const offered = nextStatuses(s.statuses);
			statusSegments(field(grid.createDiv(), p.status), offered, f.statusId, (id) => (f.statusId = id));
			dateField(body, p.checkBack, f.dueText, this.dateLabel, (t) => (f.dueText = t));
			body.createSpan({ cls: 'mtm-field-hint', text: f.person ? p.delegateHint(firstName(f.person.basename)) : p.delegateHintNobody });
			return { label: p.saveNext, run: save(() => this.delegate(current)) };
		}

		if (d === 'someday') {
			const backlog = backlogStatus(s.statuses);
			renderStepHead(body, d, p.somedayHint, back);
			const options = body.createDiv({ cls: 'mtm-destinations' });
			const chip = createSpan();
			if (backlog) statusChip(chip, backlog);
			destination(options, !f.somedayNew, 'layers', p.inExisting, chip, () => {
				f.somedayNew = false;
				this.render();
			});
			destination(options, f.somedayNew, 'cloud-moon', p.asDormant, p.dormantMeta(current.file.basename), () => {
				f.somedayNew = true;
				this.render();
			});
			if (!f.somedayNew) this.matterField(body);
			body.createSpan({ cls: 'mtm-field-hint', text: p.somedayText(backlog?.label ?? STRINGS.editors.backlog) });
			return { label: p.saveNext, run: save(() => this.someday(current)) };
		}

		if (d === 'matter') {
			renderStepHead(body, d, null, back);
			this.nameField(body);
			if (s.spheres.length) this.sphereField(body);
			const first = nextStepStatus(s.statuses);
			const stepField = field(body, p.firstStep, first ? p.firstStepIn(first.label) : undefined);
			const row = stepField.createDiv({ cls: 'mtm-process-first' });
			const tileHost = row.createSpan();
			const input = iconInput(row, 'corner-down-right', f.firstStep, p.firstStep, p.firstStepPlaceholder);
			const updateTile = () => {
				const typeId = this.parseStep(input.value).typeId ?? current.item.effective.type.id;
				const type = s.types.find((t) => t.id === typeId) ?? current.item.effective.type;
				tileHost.empty();
				tileEl(tileHost, type.icon).addClasses(typeClasses(type));
			};
			input.addEventListener('input', () => {
				f.firstStep = input.value;
				updateTile();
			});
			updateTile();
			body.createSpan({ cls: 'mtm-field-hint', text: p.matterHint });
			return { label: p.createMatter, run: save(() => this.makeMatter(current)) };
		}

		// Keep as a note.
		renderStepHead(body, d, null, back);
		const folderField = field(body, p.folder);
		const input = iconInput(folderField, 'folder', f.folder, p.folder, p.vaultRoot);
		folderField.createSpan({ cls: 'mtm-field-hint', text: p.folderHint });
		const list = body.createDiv({ cls: 'mtm-summary-list' });
		const removed = list.createDiv({ cls: 'mtm-summary-item mod-modify' });
		appendIcon(removed, 'file-pen');
		const keys = Object.keys(frontmatterOf(this.app, current.file) ?? {}).filter((k) => k.startsWith('mtm-'));
		removed.createSpan({ cls: 'mtm-summary-path', text: keys.join(', ') });
		removed.createSpan({ cls: 'mtm-summary-note', text: p.removed });
		const moved = list.createDiv({ cls: 'mtm-summary-item mod-modify' });
		appendIcon(moved, 'folder-input');
		const target = moved.createSpan({ cls: 'mtm-summary-path' });
		moved.createSpan({ cls: 'mtm-summary-note', text: p.moved });
		const updateTarget = () => {
			const folder = input.value.trim().replace(/^\/+|\/+$/g, '');
			target.setText(`${folder ? `${folder}/` : ''}${current.file.name}`);
		};
		input.addEventListener('input', () => {
			f.folder = input.value;
			updateTarget();
		});
		updateTarget();
		body.createSpan({ cls: 'mtm-field-hint', text: p.noteText });
		return { label: p.keepAsNote, run: save(() => this.keepNote(current)) };
	}

	private matterField(parent: HTMLElement): void {
		const p = STRINGS.process;
		const f = this.form;
		const el = field(parent, p.matter);
		const known = this.candidates.matters.find((m) => normalise(m.name) === normalise(f.matter));
		const input = iconInput(el, known?.icon ?? 'layers', f.matter, p.matter, p.matterPlaceholder);
		input.addClass('mtm-process-matter');
		input.addEventListener('input', () => (f.matter = input.value));
		const choices = this.candidates.matters.filter((m) => m.path !== this.settings.inboxPath);
		new MatterSuggest(this.app, input, choices, (choice) => {
			f.matter = choice.kind === 'new' ? choice.name : choice.item.name;
		});
	}

	private typeField(parent: HTMLElement): void {
		const el = field(parent, STRINGS.process.type);
		const host = el.createDiv();
		const draw = () =>
			renderTypePicker(host, this.settings.types, this.form.typeId, (type) => {
				this.form.typeId = type.id;
				draw();
			});
		draw();
	}

	private personField(parent: HTMLElement): void {
		const p = STRINGS.process;
		const f = this.form;
		const el = field(parent, p.waitingOn);
		const chips = el.createDiv({ cls: 'mtm-link-chips' });
		const pick = () =>
			new PersonPicker(this.app, this.settings.folders.people, new Set(), (person) => {
				f.person = person;
				this.render();
			}).open();
		if (f.person) {
			const chip = chips.createSpan({ cls: 'mtm-link-chip mod-waiting' });
			avatarEl(chip, f.person.basename);
			chip.createSpan({ text: f.person.basename });
			const remove = chip.createEl('button', { cls: 'mtm-chip-remove', attr: { 'aria-label': STRINGS.inspector.remove(f.person.basename) } });
			appendIcon(remove, 'x');
			remove.addEventListener('click', () => {
				f.person = null;
				this.render();
			});
		}
		const add = chips.createSpan({ cls: 'mtm-chip-add', attr: { role: 'button', tabindex: 0 } });
		appendIcon(add, f.person ? 'refresh-cw' : 'user-plus');
		add.appendText(f.person ? p.changePerson : p.choosePerson);
		add.addEventListener('click', pick);
		add.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				e.stopPropagation();
				pick();
			}
		});
	}

	private nameField(parent: HTMLElement): void {
		const p = STRINGS.process;
		const f = this.form;
		const el = field(parent, p.matter);
		const row = el.createDiv({ cls: 'mtm-name-row' });
		const trigger = row.createEl('button', { cls: 'mtm-icon-trigger', attr: { 'aria-label': STRINGS.editors.icon } });
		const draw = () => {
			trigger.empty();
			tileEl(trigger, f.icon, 'mod-neutral');
			appendIcon(trigger, 'chevron-down');
		};
		draw();
		trigger.addEventListener('click', () =>
			new IconPickerModal(this.app, f.icon, (icon) => {
				f.icon = icon;
				draw();
			}).open(),
		);
		const input = row.createEl('input', { type: 'text', value: f.name, attr: { 'aria-label': p.name } });
		input.addEventListener('input', () => (f.name = input.value));
	}

	private sphereField(parent: HTMLElement): void {
		const p = STRINGS.process;
		const f = this.form;
		const el = field(parent, p.sphere);
		const seg = el.createDiv({ cls: 'mtm-seg mod-full' });
		const options: [string | null, string, string | null][] = [
			...this.settings.spheres.map((sp): [string, string, string] => [sp.id, sp.label, sp.icon]),
			[null, p.noSphere, null],
		];
		for (const [id, label, icon] of options) {
			const item = seg.createEl('button', { cls: ['mtm-seg-item', ...(id === f.sphereId ? ['is-active'] : [])] });
			if (icon) appendIcon(item, icon);
			item.appendText(label);
			item.addEventListener('click', () => {
				f.sphereId = id;
				seg.querySelectorAll('.is-active').forEach((x) => x.removeClass('is-active'));
				item.addClass('is-active');
			});
		}
	}

	/** The first step's title and type, read like quick add (only /type counts here). */
	private parseStep(text: string): { title: string; typeId: string | null } {
		// Dates stay in the step's title: only a /type counts here.
		const result = parseQuickAdd(text, { now: new Date(), types: this.candidates.types, matters: [], people: [], languages: [] });
		return { title: result.title.trim(), typeId: result.typeId };
	}

	// ——— Writes ———

	/** One write at a time; failures show a notice and leave the item where it was. */
	private async guard(fn: () => Promise<void>): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			await fn();
		} catch (e) {
			console.error('Matters that Matter: Process Inbox failed', e);
			new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
		} finally {
			this.busy = false;
		}
	}

	/** The Matter the field names: an existing one (exact name), or a new one created now. Null when empty. */
	private async resolveMatter(): Promise<string | null> {
		const name = this.form.matter.trim();
		if (!name) {
			this.contentEl.querySelector<HTMLInputElement>('input.mtm-process-matter')?.focus();
			return null;
		}
		// Processed means leaving the Inbox: its name never resolves to it.
		const known = this.candidates.matters.find((m) => m.path !== this.settings.inboxPath && normalise(m.name) === normalise(name));
		if (known) return known.path;
		const file = await createMatter(this.app, this.settings, { name, icon: DEFAULT_MATTER_ICON, reviewEvery: null, sphereId: this.context.sphereId });
		this.candidates = loadCandidates(this.app, this.settings);
		return file.path;
	}

	private dueEdit(): { due?: ReturnType<typeof parseMtmDate> } {
		const text = this.form.dueText.trim();
		if (!text) return {};
		const parsed = this.parseDate(text);
		return parsed ? { due: parseMtmDate(parsed.due) } : {};
	}

	private async finish(current: Current, entry: TallyEntry): Promise<void> {
		this.entries.push(entry);
		const type = this.settings.types.find((t) => t.id === current.item.effective.type.id) ?? current.item.effective.type;
		this.filed.push({ type, title: current.file.basename });
		this.pendingHints = {};
		this.step = null;
		this.queue.complete();
		await this.show();
	}

	private async trash(current: Current): Promise<void> {
		const index = this.queue.index;
		const title = current.file.basename;
		const note = await trashForUndo(this.app, current.file);
		await this.finish(current, { decision: 'trash' });
		this.undo = {
			text: STRINGS.process.trashed(title),
			run: async () => {
				const file = await restoreTrashed(this.app, note);
				this.forgetLast();
				this.queue.paths[index] = file;
				this.queue.reopen(index);
				await this.show();
			},
		};
		this.redraw();
	}

	private async doneNow(current: Current): Promise<void> {
		const done = doneStatus(this.settings.statuses);
		if (!done) return;
		const index = this.queue.index;
		const previous = current.item.effective.status.id;
		await editAction(this.app, current.file, this.settings, { statusId: done.id });
		await this.finish(current, { decision: 'done' });
		this.undo = {
			text: STRINGS.process.markedDone(current.file.basename),
			run: async () => {
				await editAction(this.app, current.file, this.settings, { statusId: previous });
				this.forgetLast();
				this.queue.reopen(index);
				await this.show();
			},
		};
		this.redraw();
	}

	/** The current item, or the end when there is none left. */
	private redraw(): void {
		if (this.current) this.render();
		else this.renderEnd();
	}

	private forgetLast(): void {
		this.entries.pop();
		this.filed.pop();
	}

	private status(id: string | null): StatusDef | undefined {
		return this.settings.statuses.find((s) => s.id === id);
	}

	private async doNext(current: Current): Promise<void> {
		const status = this.status(this.form.statusId) ?? nextStatuses(this.settings.statuses)[0];
		if (!status) return;
		const matterPath = await this.resolveMatter();
		if (!matterPath) return;
		await editAction(this.app, current.file, this.settings, { statusId: status.id, matterPath, typeId: this.form.typeId }, this.dueEdit());
		await this.finish(current, { decision: 'next', detail: status.label });
	}

	private async delegate(current: Current): Promise<void> {
		const person = this.form.person;
		if (!person) {
			this.contentEl.querySelector<HTMLElement>('.mtm-process-step .mtm-chip-add')?.focus();
			return;
		}
		const status = this.status(this.form.statusId) ?? delegateStatus(this.settings.statuses, null);
		if (!status) return;
		const matterPath = await this.resolveMatter();
		if (!matterPath) return;
		this.app.saveLocalStorage(LAST_DELEGATE_KEY, status.id);
		await editAction(
			this.app,
			current.file,
			this.settings,
			{ statusId: status.id, matterPath },
			{ waitingOn: { link: linkTo(this.app, person, current.file.path), key: person.path }, ...this.dueEdit() },
		);
		await this.finish(current, { decision: 'delegate', detail: firstName(person.basename) });
	}

	private async someday(current: Current): Promise<void> {
		const backlog = backlogStatus(this.settings.statuses);
		if (!backlog) return;
		let matterPath: string | null;
		if (this.form.somedayNew) {
			const file = await createMatter(this.app, this.settings, {
				name: current.file.basename,
				icon: DEFAULT_MATTER_ICON,
				reviewEvery: null,
				sphereId: this.context.sphereId,
			});
			await setMatterState(this.app, file, 'dormant');
			matterPath = file.path;
			this.candidates = loadCandidates(this.app, this.settings);
		} else matterPath = await this.resolveMatter();
		if (!matterPath) return;
		await editAction(this.app, current.file, this.settings, { statusId: backlog.id, matterPath });
		await this.finish(current, { decision: 'someday' });
	}

	private async makeMatter(current: Current): Promise<void> {
		const f = this.form;
		const name = f.name.trim();
		if (!name) {
			this.contentEl.querySelector<HTMLInputElement>('.mtm-name-row input')?.focus();
			return;
		}
		const matter = await createMatter(this.app, this.settings, { name, icon: f.icon, reviewEvery: null, sphereId: f.sphereId });
		this.candidates = loadCandidates(this.app, this.settings);
		const step = this.parseStep(f.firstStep);
		const status = nextStepStatus(this.settings.statuses);
		await editAction(this.app, current.file, this.settings, {
			matterPath: matter.path,
			...(status ? { statusId: status.id } : {}),
			...(step.typeId ? { typeId: step.typeId } : {}),
		});
		if (step.title) await renameAction(this.app, current.file, step.title);
		await this.finish(current, { decision: 'matter' });
	}

	private async keepNote(current: Current): Promise<void> {
		await keepAsNote(this.app, current.file, this.form.folder);
		await this.finish(current, { decision: 'note' });
	}

	// ——— The end ———

	private renderEnd(): void {
		const { contentEl } = this;
		contentEl.empty();
		swapClasses(this.modalEl, ['mtm-type-', 'mtm-tone-'], []);
		renderBar(contentEl, this.queue.total, this.queue.total, this.queue.processed);
		if (this.undo) this.renderUndo(contentEl, this.undo);
		renderEnd(
			contentEl,
			{ filed: this.filed, tally: tally(this.entries), left: this.queue.left, empty: this.queue.total === 0 },
			{
				openBoard: () => {
					this.close();
					void this.plugin.openBoard();
				},
				close: () => this.close(),
			},
		);
	}
}
