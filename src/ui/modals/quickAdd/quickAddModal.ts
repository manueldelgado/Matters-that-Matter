// Quick add: one line with tokens (/type, #Matter, @person, !priority, dates) becomes an Action.

import { Modal, normalizePath, Notice, Scope, setTooltip, type TFile } from 'obsidian';
import type MattersPlugin from '../../../main';
import type { TypeDef } from '../../../settings';
import { STRINGS } from '../../../strings';
import { toYmd } from '../../../model/dates';
import { backlogStatus, defaultType } from '../../../model/workflow';
import { sanitiseTitle } from '../../../model/titles';
import { normalise, rank, STRONG_MATCH } from '../../../services/fuzzy';
import {
	activeToken,
	draftOf,
	isNameLike,
	isNewPath,
	newName,
	newPath,
	replaceSpan,
	rewriteTypeToken,
	tokenName,
	type ActiveToken,
	type Draft,
} from '../../../services/quickAdd';
import { parseQuickAdd, type QuickAddContext, type QuickAddResult, type TypeCandidate } from '../../../services/quickAddParser';
import { createAction } from '../../../vault/actionWrites';
import { allActionItems, allMatters, DEFAULT_MATTER_ICON } from '../../../vault/index';
import { createMatter } from '../../../vault/matterWrites';
import { createPersonNote, frontmatterOf } from '../../../vault/notes';
import { appendIcon, swapClasses, tileEl, typeClasses } from '../../components/dom';
import {
	isSuggestion,
	renderSuggestions,
	renderTokens,
	renderTypePicker,
	type MatterCandidate,
	type PersonCandidate,
	type Suggestion,
	type SuggestRow,
} from './quickAddRender';

const MATTER_LIMIT = 6;
const PEOPLE_LIMIT = 5;
const OTHER_LIMIT = 3;

export interface QuickAddInit {
	/** Matter of the lane the modal was opened from. */
	matterPath?: string;
	/** Status of the column the modal was opened from. */
	statusId?: string;
	/** Due date of the calendar day the modal was opened from ('YYYY-MM-DD'). */
	due?: string;
	/** The Sphere a board is focused on: a new Matter typed with # goes there. */
	sphereId?: string | null;
	/** Type of the list group the modal was opened from. */
	typeId?: string;
	/** Text to start with, such as a person token ("@Marco "). */
	text?: string;
}

export class QuickAddModal extends Modal {
	private types: TypeCandidate[] = [];
	private matters: MatterCandidate[] = [];
	private people: PersonCandidate[] = [];

	private contextMatter: string | null;
	private readonly contextStatus: string | null;
	private contextDue: string | null;
	private contextSphere: string | null;
	private pickedType: string | null = null;
	private readonly contextType: string | null;
	private readonly initialText: string;
	private ignoredDates: string[] = [];
	/** Start of a token whose suggestions were closed with Escape. */
	private dismissedAt: number | null = null;
	private busy = false;

	private result: QuickAddResult | null = null;
	private draft: Draft | null = null;
	private token: ActiveToken | null = null;
	private rows: SuggestRow[] = [];
	/** Start and query of the token the selection belongs to. */
	private tokenKey = '';
	private selected = 0;

	private input!: HTMLInputElement;
	private tileHost!: HTMLElement;
	private field!: HTMLElement;
	private suggestEl: HTMLElement | null = null;
	private titleLine!: HTMLElement;
	private tokensEl!: HTMLElement;
	private pickerEl!: HTMLElement;
	private addButton!: HTMLButtonElement;

	constructor(
		private plugin: MattersPlugin,
		init: QuickAddInit = {},
	) {
		super(plugin.app);
		this.contextMatter = init.matterPath ?? null;
		this.contextStatus = init.statusId ?? null;
		this.contextDue = init.due ?? null;
		this.contextSphere = init.sphereId ?? null;
		this.contextType = init.typeId ?? null;
		this.pickedType = this.contextType;
		this.initialText = init.text ?? '';
		// Escape closes the suggestions first, then the modal.
		this.scope = new Scope(this.app.scope);
		this.scope.register([], 'Escape', () => {
			if (this.suggestionsOpen()) {
				this.dismissedAt = this.token?.start ?? null;
				this.refresh();
			} else this.close();
			return false;
		});
	}

	private get settings() {
		return this.plugin.settings;
	}

	onOpen(): void {
		this.loadCandidates();
		const q = STRINGS.quickAdd;
		this.modalEl.addClass('mtm-quick-add');
		const { contentEl } = this;
		contentEl.empty();

		const head = contentEl.createDiv({ cls: 'mtm-qa-head' });
		this.tileHost = head.createSpan();
		this.field = head.createDiv({ cls: 'mtm-qa-field' });
		this.input = this.field.createEl('input', {
			cls: 'mtm-qa-input',
			type: 'text',
			attr: { 'aria-label': q.inputLabel, autocomplete: 'off', spellcheck: 'false' },
		});
		this.titleLine = contentEl.createDiv({ cls: 'mtm-qa-title' });
		this.tokensEl = contentEl.createDiv({ cls: 'mtm-qa-tokens' });
		this.pickerEl = contentEl.createDiv({ cls: 'mtm-qa-section' });

		const footer = contentEl.createDiv({ cls: 'mtm-qa-footer' });
		const hint = footer.createSpan();
		q.hint.forEach(([key, label], i) => {
			if (i > 0) hint.appendText(' · ');
			hint.createEl('b', { text: key });
			hint.appendText(` ${label}`);
		});
		hint.appendText(` · ${q.hintDates}`);
		footer.createSpan({ cls: 'mtm-spacer' });
		footer.createEl('button', { text: q.cancel }).addEventListener('click', () => this.close());
		this.addButton = footer.createEl('button', { cls: 'mod-cta', text: q.add });
		setTooltip(this.addButton, q.addTooltip);
		this.addButton.addEventListener('click', () => void this.submit(false));

		this.input.addEventListener('input', () => this.refresh());
		this.input.addEventListener('click', () => this.refresh());
		this.input.addEventListener('keyup', (e) => {
			if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) this.refresh();
		});
		this.input.addEventListener('keydown', (e) => this.onKeyDown(e));

		this.input.value = this.initialText;
		this.refresh();
		this.input.focus();
		this.input.setSelectionRange(this.initialText.length, this.initialText.length);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	// ——— Candidates ———

	private loadCandidates(): void {
		const { app } = this;
		const s = this.settings;
		const today = toYmd(new Date());
		this.types = s.types.map((t) => ({ id: t.id, names: [t.label, t.id] }));

		const open = new Map<string, number>();
		for (const item of allActionItems(app, s)) {
			if (item.category !== 'closed') open.set(item.effective.matterPath, (open.get(item.effective.matterPath) ?? 0) + 1);
		}
		const q = STRINGS.quickAdd;
		this.matters = allMatters(app, s, today).map((m) => ({
			path: m.path,
			name: m.name,
			names: [m.name],
			icon: m.icon,
			// The Inbox first among equal matches.
			rank: m.isInbox ? 0 : 1,
			meta: m.state === 'closed' ? q.closed : m.state === 'dormant' ? q.dormant : open.get(m.path) ? q.open(open.get(m.path) ?? 0) : '',
		}));

		const folder = normalizePath(s.folders.people) + '/';
		// People are ordinary notes; Actions and Matters are never people.
		this.people = app.vault
			.getMarkdownFiles()
			.filter((f) => frontmatterOf(app, f)?.['mtm-kind'] === undefined)
			.map((f) => {
				const inPeople = f.path.startsWith(folder);
				const parent = f.parent?.path ?? '';
				return { path: f.path, name: f.basename, names: [f.basename], rank: inPeople ? 0 : 1, inPeople, folder: parent === '/' ? '' : parent };
			});
	}

	private parserContext(): QuickAddContext {
		return { now: new Date(), types: this.types, matters: this.matters, people: this.people, ignoredDates: this.ignoredDates };
	}

	// ——— State ———

	private refresh(): void {
		const s = this.settings;
		const value = this.input.value;
		const caret = this.input.selectionStart ?? value.length;
		const result = parseQuickAdd(value, this.parserContext());
		const draft = draftOf(result, {
			contextMatter: this.contextMatter,
			contextStatus: this.contextStatus,
			pickedType: this.pickedType,
			contextDue: this.contextDue,
			inboxPath: s.inboxPath,
			backlogId: backlogStatus(s.statuses)?.id ?? s.statuses[0]?.id ?? '',
			defaultTypeId: defaultType(s.types)?.id ?? s.types[0]?.id ?? '',
		});
		this.result = result;
		this.draft = draft;

		const token = activeToken(value, caret);
		if (this.dismissedAt !== null && token?.start !== this.dismissedAt) this.dismissedAt = null;
		this.token = token && token.start !== this.dismissedAt ? token : null;
		const key = this.token ? `${this.token.start}:${this.token.query}` : '';
		if (key !== this.tokenKey) {
			this.selected = 0;
			this.tokenKey = key;
		}
		this.rows = this.token ? this.suggestionsFor(this.token) : [];
		this.selected = Math.min(this.selected, Math.max(0, this.choices().length - 1));
		this.render();
	}

	private suggestionsOpen(): boolean {
		return this.choices().length > 0;
	}

	private choices(): Suggestion[] {
		return this.rows.filter(isSuggestion);
	}

	private suggestionsFor(token: ActiveToken): SuggestRow[] {
		const q = token.query;
		const words = q.split(/\s+/).filter(Boolean).length;
		const name = sanitiseTitle(q);
		const isNew = (list: readonly { name: string }[]) => !!name && !list.some((c) => normalise(c.name) === normalise(name));
		// Past the first word, keep suggesting while a name still matches strongly or the words continue a name ("Ana García").
		const hasStrong = (ranked: readonly { score: number }[]) => ranked.some((r) => r.score >= STRONG_MATCH);
		const tooLoose = (ranked: readonly { score: number }[]) => words > 1 && !token.quoted && !hasStrong(ranked) && !isNameLike(q);

		if (token.sigil === '#') {
			const ranked = q ? rank(q, this.matters) : [];
			if (tooLoose(ranked)) return [];
			const found = q
				? ranked.slice(0, MATTER_LIMIT).map((r) => r.item)
				: [...this.matters].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.name.localeCompare(b.name)).slice(0, MATTER_LIMIT);
			const rows: SuggestRow[] = found.map((item) => ({ kind: 'matter', item }));
			if (isNew(this.matters)) {
				// Without a strong match, creating what was typed is the likely intent, so it comes first.
				if (hasStrong(ranked)) rows.push({ kind: 'new-matter', name });
				else rows.unshift({ kind: 'new-matter', name });
			}
			return rows;
		}

		const ranked = q ? rank(q, this.people) : [];
		if (tooLoose(ranked)) return [];
		const offerNew = isNew(this.people);
		const all = q ? ranked.map((r) => r.item) : this.people.filter((p) => p.inPeople).sort((a, b) => a.name.localeCompare(b.name));
		const inPeople = all.filter((p) => p.inPeople).slice(0, PEOPLE_LIMIT);
		const others = q ? all.filter((p) => !p.inPeople).slice(0, OTHER_LIMIT) : [];
		const rows: SuggestRow[] = [];
		const p = STRINGS.quickAdd;
		if (inPeople.length) {
			if (others.length) rows.push({ kind: 'group', label: p.people });
			rows.push(...inPeople.map((item): SuggestRow => ({ kind: 'person', item })));
		}
		if (others.length) {
			if (inPeople.length) rows.push({ kind: 'sep' });
			rows.push({ kind: 'group', label: p.otherNotes }, ...others.map((item): SuggestRow => ({ kind: 'person', item })));
		}
		if (offerNew) {
			if (hasStrong(ranked)) rows.push({ kind: 'new-person', name });
			else rows.unshift({ kind: 'new-person', name }, ...(rows.length ? [{ kind: 'sep' } as const] : []));
		}
		return rows;
	}

	// ——— Rendering ———

	private typeOf(id: string): TypeDef | undefined {
		return this.settings.types.find((t) => t.id === id);
	}

	private render(): void {
		const draft = this.draft;
		const result = this.result;
		if (!draft || !result) return;
		const s = this.settings;
		const q = STRINGS.quickAdd;
		const type = this.typeOf(draft.typeId);

		if (type) swapClasses(this.modalEl, ['mtm-type-', 'mtm-tone-'], typeClasses(type));
		this.tileHost.empty();
		if (type) tileEl(this.tileHost, type.icon, 'mod-lg');

		const contextName = this.contextMatter ? this.matters.find((m) => m.path === this.contextMatter)?.name : undefined;
		this.input.placeholder = contextName ? q.placeholderIn(contextName) : q.placeholder;

		this.suggestEl?.remove();
		this.suggestEl = null;
		if (this.suggestionsOpen() && this.token) {
			this.suggestEl = this.field.createDiv({ cls: 'mtm-suggest', attr: { role: 'listbox' } });
			renderSuggestions(this.suggestEl, this.rows, this.selected, this.token.query, normalizePath(s.folders.people), (choice) =>
				this.accept(choice),
			);
		}

		// The title line shows only once tokens have changed the text.
		const typed = this.input.value.replace(/\s+/g, ' ').trim();
		this.titleLine.empty();
		this.titleLine.toggle(!!draft.title && draft.title !== typed);
		if (draft.title && draft.title !== typed) {
			appendIcon(this.titleLine, 'file-text');
			this.titleLine.createSpan({ text: q.savedAs });
			this.titleLine.createEl('b', { text: sanitiseTitle(draft.title) || draft.title });
		}

		const inbox = this.matters.find((m) => m.path === s.inboxPath);
		renderTokens(this.tokensEl, {
			draft,
			chips: result.chips,
			typingAt: this.suggestionsOpen() ? (this.token?.start ?? null) : null,
			types: s.types,
			status: s.statuses.find((x) => x.id === draft.statusId),
			matter: this.matters.find((m) => m.path === draft.matterPath),
			matterFromContext: !draft.matterIsDefault && !result.matterPath,
			peopleFolder: normalizePath(s.folders.people),
			inboxName: inbox?.name ?? s.inboxPath.split('/').pop()?.replace(/\.md$/i, '') ?? s.inboxPath,
			today: toYmd(new Date()),
			onRemoveDate: (chip) => {
				this.ignoredDates.push(chip.text);
				this.refocus();
			},
			onRemoveMatter: () => {
				this.contextMatter = null;
				this.refocus();
			},
			onRemoveContextDue: () => {
				this.contextDue = null;
				this.refocus();
			},
		});

		renderTypePicker(this.pickerEl, s.types, draft.typeId, (t) => this.pickType(t));
		this.addButton.disabled = !draft.canAdd || this.busy;
	}

	private refocus(): void {
		this.refresh();
		this.input.focus();
	}

	// ——— Input ———

	private onKeyDown(e: KeyboardEvent): void {
		if (e.isComposing) return;
		const choices = this.choices();
		if (choices.length) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				const step = e.key === 'ArrowDown' ? 1 : -1;
				this.selected = (this.selected + step + choices.length) % choices.length;
				this.render();
				return;
			}
			if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
				e.preventDefault();
				const choice = choices[this.selected];
				if (choice) this.accept(choice);
				return;
			}
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			void this.submit(e.shiftKey);
		}
	}

	private setInput(value: string, caret: number): void {
		this.input.value = value;
		this.input.setSelectionRange(caret, caret);
		this.refocus();
	}

	/** Writes the chosen name into the input: plain when it resolves as typed, otherwise in quotes. */
	private accept(choice: Suggestion): void {
		const token = this.token;
		if (!token) return;
		let name: string;
		let path: string;
		if (choice.kind === 'new-matter') {
			name = choice.name;
			path = newPath(name);
			this.matters.push({ path, name, names: [name], icon: DEFAULT_MATTER_ICON, meta: '', rank: 0 });
		} else if (choice.kind === 'new-person') {
			name = choice.name;
			path = newPath(name);
			this.people.push({ path, name, names: [name], rank: 0, inPeople: true, folder: '' });
		} else {
			name = choice.item.name;
			path = choice.item.path;
		}
		const value = this.input.value;
		const plain = replaceSpan(value, token.start, token.end, token.sigil + name);
		const chip = parseQuickAdd(plain.input, this.parserContext()).chips.find((c) => c.start === token.start);
		const resolves = chip && (chip.kind === 'matter' || chip.kind === 'person') && chip.path === path;
		const next = resolves ? plain : replaceSpan(value, token.start, token.end, token.sigil + tokenName(name));
		// The accepted token stops suggesting until the caret moves to another one.
		this.dismissedAt = token.start;
		this.setInput(next.input, next.caret);
	}

	/** The picker rewrites the typed `/type` token, so the text stays the single source of truth. */
	private pickType(type: TypeDef): void {
		this.pickedType = type.id;
		const rewritten = this.result ? rewriteTypeToken(this.input.value, this.result.chips, type.label) : null;
		if (rewritten !== null) this.setInput(rewritten, rewritten.length);
		else this.refocus();
	}

	// ——— Adding ———

	private async submit(keepOpen: boolean): Promise<void> {
		this.refresh();
		const draft = this.draft;
		if (!draft?.canAdd || this.busy) return;
		this.busy = true;
		this.addButton.disabled = true;
		const { app } = this;
		const s = this.settings;
		try {
			let matterPath = draft.matterPath;
			if (isNewPath(matterPath)) {
				const file = await createMatter(app, s, { name: newName(matterPath), icon: DEFAULT_MATTER_ICON, reviewEvery: null, sphereId: this.contextSphere });
				this.adopt(this.matters, matterPath, file);
				matterPath = file.path;
			}
			const people: TFile[] = [];
			for (const p of draft.people) {
				if (isNewPath(p)) {
					const file = await createPersonNote(app, s.folders.people, newName(p));
					this.adopt(this.people, p, file);
					people.push(file);
				} else {
					const file = app.vault.getFileByPath(p);
					if (file) people.push(file);
				}
			}
			const file = await createAction(app, s, {
				title: draft.title,
				statusId: draft.statusId,
				typeId: draft.typeId,
				matterPath,
				priority: draft.priority,
				start: draft.start,
				due: draft.due,
				people,
			});
			this.notifyAdded(file, draft, matterPath);
			if (keepOpen) {
				this.input.value = '';
				this.ignoredDates = [];
				this.pickedType = this.contextType;
				this.dismissedAt = null;
			} else this.close();
		} catch (e) {
			new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
		} finally {
			this.busy = false;
			if (keepOpen) this.refocus();
		}
	}

	/** A Matter or person created on add replaces its stand-in, so the next capture finds the real note. */
	private adopt(list: (MatterCandidate | PersonCandidate)[], standIn: string, file: TFile): void {
		const item = list.find((c) => c.path === standIn);
		if (!item) return;
		item.path = file.path;
		item.name = file.basename;
		item.names = [file.basename];
		if (this.contextMatter === standIn) this.contextMatter = file.path;
	}

	private notifyAdded(file: TFile, draft: Draft, matterPath: string): void {
		const type = this.typeOf(draft.typeId);
		const matter = this.matters.find((m) => m.path === matterPath)?.name ?? matterPath;
		const status = this.settings.statuses.find((x) => x.id === draft.statusId)?.label ?? draft.statusId;
		const fragment = createFragment((f) => {
			const row = f.createDiv({ cls: ['mtm-added', ...(type ? typeClasses(type) : [])] });
			if (type) tileEl(row, type.icon, 'mod-sm');
			const text = row.createSpan({ cls: 'mtm-added-text' });
			text.createSpan({ cls: 'mtm-added-title', text: file.basename });
			text.createSpan({ cls: 'mtm-added-dest', text: STRINGS.quickAdd.added(matter, status) });
		});
		const notice = new Notice(fragment, 6000);
		notice.messageEl.addEventListener('click', () => void this.plugin.selectAction(file.path));
	}
}
