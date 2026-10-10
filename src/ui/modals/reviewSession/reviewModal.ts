// Review session: steps through the Matters whose review is due, one at a time, asking a few questions about each.
// Every answer is written at once; "Reviewed, next" writes the review date. A session of one Matter skips the start
// and end screens.

import { Keymap, Modal, Notice, Scope, type EventRef, type TFile } from 'obsidian';
import type MattersPlugin from '../../../main';
import { STRINGS } from '../../../strings';
import { dayLabel, toYmd } from '../../../model/dates';
import type { MatterState } from '../../../model/matters';
import type { ActionItem } from '../../../services/actionItems';
import { orderMatters, type MatterInfo } from '../../../services/boardModel';
import { nextStepStatus } from '../../../services/nextAction';
import {
	emptyTally,
	longWaitsAcross,
	needsNoLook,
	nextReview,
	reviewQueue,
	reviewStep,
	type ReviewStep,
	type ReviewTally,
} from '../../../services/reviewSession';
import { allActionItems, allMatters } from '../../../vault/index';
import { markReviewed, setMatterOutcome, setMatterState, setReviewCadence } from '../../../vault/matterWrites';
import { bindCardActions, renderCard } from '../../components/card';
import { appendIcon, pressable, tileEl } from '../../components/dom';
import { renderCadenceControl, renderOutcomeField, renderStateSeg } from '../../components/matterControls';
import { kbd } from '../processInbox/processRender';
import { question, renderBar, renderHead, renderTally, reviewLabel } from './reviewRender';

/** Cards shown under "Long waits" at the end. */
const END_WAITS = 4;
/** Matters shown in the end screen's filed stack. */
const END_STACK = 3;

export interface ReviewContext {
	/** The Sphere a board is focused on: only its Matters come up. */
	sphereId?: string | null;
	/** A session of one: this Matter only ("Review now"). */
	only?: string;
}

type Phase = 'start' | 'step' | 'end';

export class ReviewModal extends Modal {
	private phase: Phase = 'start';
	private scopeAll = false;
	private queue: string[] = [];
	private index = 0;
	private tally: ReviewTally = emptyTally();
	/** Matters reviewed in this session, for "Next reviews". */
	private reviewed: string[] = [];
	/** Per Matter, so a second edit doesn't count twice. */
	private outcomeEdited = new Set<string>();
	/** Each Matter's state before the session changed it, and after. */
	private stateFrom = new Map<string, MatterState>();
	private stateTo = new Map<string, MatterState>();
	/** The cadence dropdown shows Custom (chosen, not yet committed). */
	private customCadence = false;
	/** Open Actions in the current Matter when quick add opened, to count a next step added. */
	private openBefore: number | null = null;
	private cacheRefs: EventRef[] = [];
	private vaultRefs: EventRef[] = [];
	private renderSoon: number | null = null;

	constructor(
		private plugin: MattersPlugin,
		private context: ReviewContext = {},
	) {
		super(plugin.app);
		// Our own scope for → and Enter replaces the modal's, which held Escape: register it again.
		this.scope = new Scope(this.app.scope);
		this.scope.register([], 'Escape', () => {
			// Typing in a field: Escape is the field's.
			if (this.editing()) return true;
			this.close();
			return false;
		});
		this.scope.register([], 'ArrowRight', () => {
			if (this.phase !== 'step' || this.editing()) return true;
			this.skip();
			return false;
		});
		this.scope.register([], 'Enter', (e) => {
			if (this.editing() || e.isComposing) return true;
			const el = activeDocument.activeElement;
			if (el?.instanceOf(HTMLElement) && (el.tagName === 'BUTTON' || el.tagName === 'SELECT' || el.getAttribute('role'))) return true;
			if (this.phase === 'start' && this.queue.length) this.begin();
			else if (this.phase === 'step') void this.markAndNext();
			else return true;
			return false;
		});
	}

	private get settings() {
		return this.plugin.settings;
	}

	onOpen(): void {
		this.modalEl.addClass('mtm-modal', 'mtm-process', 'mtm-review');
		if (this.context.only) {
			this.queue = [this.context.only];
			this.phase = 'step';
		} else this.queue = this.buildQueue();
		// Answers and edits elsewhere (quick add, the inspector) show up in the step.
		const { metadataCache, vault } = this.app;
		this.cacheRefs.push(metadataCache.on('changed', () => this.refreshSoon()));
		this.vaultRefs.push(vault.on('delete', () => this.refreshSoon()));
		this.render();
	}

	onClose(): void {
		for (const ref of this.cacheRefs) this.app.metadataCache.offref(ref);
		for (const ref of this.vaultRefs) this.app.vault.offref(ref);
		this.cacheRefs = [];
		this.vaultRefs = [];
		if (this.renderSoon !== null) window.clearTimeout(this.renderSoon);
		this.contentEl.empty();
	}

	/** Typing somewhere: keys belong to the field, and a re-render would lose the text. */
	private editing(): boolean {
		const el = activeDocument.activeElement;
		return !!el?.instanceOf(HTMLElement) && this.contentEl.contains(el) && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
	}

	private refreshSoon(): void {
		if (this.renderSoon !== null) window.clearTimeout(this.renderSoon);
		this.renderSoon = window.setTimeout(() => {
			this.renderSoon = null;
			if (this.phase === 'step' && !this.editing()) this.render();
		}, 150);
	}

	// ——— Data ———

	private matters(): MatterInfo[] {
		const s = this.settings;
		return orderMatters(allMatters(this.app, s, toYmd(new Date())), s.spheres, s.defaultInboxPosition);
	}

	private buildQueue(): string[] {
		return reviewQueue(this.matters(), { scope: this.scopeAll ? 'all' : 'due', sphere: this.context.sphereId ?? null }).map((m) => m.path);
	}

	private file(path: string): TFile | null {
		return this.app.vault.getFileByPath(path);
	}

	private async write(fn: () => Promise<unknown>): Promise<void> {
		try {
			await fn();
		} catch (e) {
			console.error('Matters that Matter: write failed', e);
			new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
		}
	}

	// ——— Moving ———

	private begin(): void {
		this.phase = 'step';
		this.index = 0;
		this.render();
	}

	private advance(): void {
		this.customCadence = false;
		this.index++;
		if (this.index < this.queue.length) {
			this.render();
			return;
		}
		if (this.context.only) {
			this.close();
			return;
		}
		this.phase = 'end';
		this.render();
	}

	private skip(): void {
		this.tally.skipped++;
		this.advance();
	}

	private async markAndNext(): Promise<void> {
		const path = this.queue[this.index];
		const file = path ? this.file(path) : null;
		if (file) {
			await this.write(() => markReviewed(this.app, file));
			this.tally.reviewed++;
			this.reviewed.push(file.path);
			if (this.context.only) {
				const today = toYmd(new Date());
				const next = nextReview(this.matters().find((m) => m.path === file.path)?.review?.cadence ?? null, today);
				new Notice(STRINGS.review.reviewedNotice(file.basename, next ? dayLabel(next, today) : null));
			}
		}
		this.advance();
	}

	private setState(matter: MatterInfo, state: MatterState): void {
		const file = this.file(matter.path);
		if (!file) return;
		if (!this.stateFrom.has(matter.path)) this.stateFrom.set(matter.path, matter.state);
		this.stateTo.set(matter.path, state);
		this.recountStates();
		void this.write(() => setMatterState(this.app, file, state));
	}

	/** Where each Matter ended up, once per Matter; changing back counts nothing. */
	private recountStates(): void {
		const counts = { woken: 0, madeDormant: 0, closed: 0 };
		for (const [path, to] of this.stateTo) {
			if (to === this.stateFrom.get(path)) continue;
			if (to === 'active') counts.woken++;
			else if (to === 'dormant') counts.madeDormant++;
			else counts.closed++;
		}
		Object.assign(this.tally, counts);
	}

	private openQuickAdd(matter: MatterInfo, items: readonly ActionItem[]): void {
		this.openBefore = items.filter((i) => i.effective.matterPath === matter.path && i.category !== 'closed').length;
		this.plugin.quickAdd({
			matterPath: matter.path,
			statusId: nextStepStatus(this.settings.statuses)?.id,
			sphereId: this.context.sphereId ?? null,
			onClose: () => {
				// Give the new note a moment to be parsed, then count it.
				window.setTimeout(() => {
					const now = allActionItems(this.app, this.settings).filter((i) => i.effective.matterPath === matter.path && i.category !== 'closed').length;
					if (this.openBefore !== null && now > this.openBefore) this.tally.nextAdded += now - this.openBefore;
					this.openBefore = null;
					if (this.phase === 'step') this.render();
				}, 300);
			},
		});
	}

	// ——— Rendering ———

	private render(): void {
		const { contentEl } = this;
		const scroll = contentEl.scrollTop;
		contentEl.empty();
		if (this.phase === 'start') this.renderStart();
		else if (this.phase === 'step') this.renderStep();
		else this.renderEnd();
		contentEl.scrollTop = this.phase === 'step' ? scroll : 0;
	}

	private renderStart(): void {
		const r = STRINGS.review;
		const { contentEl } = this;
		const today = toYmd(new Date());
		const matters = this.matters();
		const byPath = new Map(matters.map((m) => [m.path, m]));
		renderBar(contentEl);

		const start = contentEl.createDiv({ cls: 'mtm-review-start' });
		const count = this.queue.length;
		start.createEl('h2', { cls: 'mtm-review-start-title', text: count ? r.startTitle(count) : r.nothingTitle });
		start.createEl('p', { cls: 'mtm-review-start-text', text: count ? r.startText : r.nothingText });

		if (count) {
			const list = start.createDiv({ cls: 'mtm-review-queue' });
			for (const path of this.queue) {
				const m = byPath.get(path);
				if (!m) continue;
				const row = list.createDiv({ cls: 'mtm-review-queue-row' });
				tileEl(row, m.icon, 'mod-neutral');
				row.createSpan({ cls: 'mtm-review-queue-name', text: m.name });
				reviewLabel(row, m, today, true);
			}
		}

		// The Inbox first, when it has open Actions: Process Inbox, then back here.
		const inbox = allActionItems(this.app, this.settings).filter(
			(i) => i.effective.matterPath === this.settings.inboxPath && i.category !== 'closed',
		).length;
		if (inbox) {
			const notice = start.createDiv({ cls: 'mtm-notice mod-info' });
			appendIcon(notice, 'inbox');
			const text = notice.createDiv();
			text.createEl('b', { text: r.inboxTitle(inbox) });
			text.appendText(` ${r.inboxText}`);
			notice.createEl('button', { text: r.processFirst }).addEventListener('click', () => {
				const sphereId = this.context.sphereId ?? null;
				this.close();
				this.plugin.processInbox(sphereId, () => this.plugin.reviewMatters({ sphereId }));
			});
		}

		const active = reviewQueue(matters, { scope: 'all', sphere: this.context.sphereId ?? null }).filter((m) => m.state === 'active').length;
		if (!this.scopeAll && active > count) {
			const all = pressable(start.createSpan({ cls: 'mtm-review-all' }), () => {
				this.scopeAll = true;
				this.queue = this.buildQueue();
				this.render();
			});
			appendIcon(all, 'list-checks');
			all.appendText(r.reviewAll(active));
		}

		const footer = contentEl.createDiv({ cls: 'mtm-modal-footer' });
		footer.createEl('button', { text: r.close }).addEventListener('click', () => this.close());
		if (count) footer.createEl('button', { cls: 'mod-cta', text: r.start }).addEventListener('click', () => this.begin());
	}

	private renderStep(): void {
		const r = STRINGS.review;
		const { contentEl } = this;
		const now = new Date();
		const today = toYmd(now);
		const path = this.queue[this.index];
		const matter = path ? this.matters().find((m) => m.path === path) : undefined;
		const file = path ? this.file(path) : null;
		if (!matter || !file) {
			// Gone meanwhile (deleted or renamed by hand): move on.
			this.advance();
			return;
		}
		const items = allActionItems(this.app, this.settings);
		const step = reviewStep(matter, items, this.settings.statuses, now);

		if (!this.context.only) renderBar(contentEl, { position: this.index + 1, total: this.queue.length, done: this.index });
		else renderBar(contentEl);
		renderHeadAndSince(contentEl, step, this.settings.spheres, today);

		const body = contentEl.createDiv({ cls: 'mtm-review-body' });
		if (!step.dormant) this.renderNeedsLook(body, step, now);

		renderOutcomeField(question(body, r.questions.outcome), matter.outcome, (text) => {
			if (!this.outcomeEdited.has(matter.path)) {
				this.outcomeEdited.add(matter.path);
				this.tally.outcomes++;
			}
			void this.write(() => setMatterOutcome(this.app, file, text));
		});

		if (!step.dormant) this.renderNext(body, step, items, now);

		const stateQ = question(body, r.questions.state);
		if (step.dormant) this.renderDormantChoices(stateQ, matter);
		else renderStateSeg(stateQ, matter.state, (state) => this.setState(matter, state));

		const cadenceQ = question(body, r.questions.cadence);
		const row = cadenceQ.createDiv({ cls: 'mtm-review-row' });
		renderCadenceControl(
			row,
			this.app.metadataCache.getFileCache(file)?.frontmatter?.['mtm-review-every'],
			this.customCadence,
			{
				setCadence: (cadence) => {
					this.customCadence = false;
					void this.write(() => setReviewCadence(this.app, file, cadence));
				},
				chooseCustom: () => {
					this.customCadence = true;
					this.render();
				},
			},
		);
		const next = nextReview(matter.review?.cadence ?? null, today);
		row.createSpan({ cls: 'mtm-field-hint', text: next ? r.nextReview(dayLabel(next, today)) : r.noRhythm });

		const footer = contentEl.createDiv({ cls: 'mtm-modal-footer' });
		const hints = footer.createSpan({ cls: 'mtm-process-hints' });
		for (const [key, label] of [
			['→', r.skip],
			['↵', r.reviewed],
		] as const) {
			const hint = hints.createSpan();
			kbd(hint, key);
			hint.appendText(label);
		}
		footer.createEl('button', { text: r.openMatter }).addEventListener('click', () => {
			this.close();
			void this.plugin.openMatter(matter.path);
		});
		footer.createEl('button', { text: r.skip }).addEventListener('click', () => this.skip());
		const last = this.index >= this.queue.length - 1;
		footer.createEl('button', { cls: 'mod-cta', text: last ? r.reviewed : r.reviewedNext }).addEventListener('click', () => void this.markAndNext());
	}

	private cards(parent: HTMLElement, list: readonly ActionItem[], now: Date, withMatter = false): void {
		const matters = withMatter ? new Map(this.matters().map((m) => [m.path, m])) : null;
		for (const item of list) {
			const m = matters?.get(item.effective.matterPath);
			const card = renderCard(parent, item, {
				now,
				selected: item.path === this.plugin.selection.path,
				matterName: m?.name,
				matterIcon: m?.icon,
				onDismiss: () => {},
			});
			bindCardActions(card, item.path, {
				select: (p) => void this.plugin.selectAction(p),
				open: (p, e) => {
					const f = this.file(p);
					if (!f) return;
					this.close();
					void this.app.workspace.getLeaf(Keymap.isModEvent(e) || 'tab').openFile(f);
				},
			});
		}
	}

	private renderNeedsLook(body: HTMLElement, step: ReviewStep, now: Date): void {
		const r = STRINGS.review;
		const section = body.createDiv({ cls: 'mtm-review-section' });
		section.createDiv({ cls: 'mtm-section-title', text: r.needsLook });
		if (needsNoLook(step)) {
			const calm = section.createDiv({ cls: 'mtm-review-calm' });
			appendIcon(calm, 'circle-check');
			calm.appendText(r.calm);
			return;
		}
		const look = [...step.overdue, ...step.longWaits];
		if (look.length) this.cards(section.createDiv({ cls: 'mtm-stack' }), look, now);
		if (step.noNextAction) {
			const pill = section.createDiv({ cls: 'mtm-review-row' }).createSpan({ cls: 'mtm-stalled' });
			appendIcon(pill, 'signpost');
			pill.appendText(STRINGS.nextAction.hint);
		}
	}

	private renderNext(body: HTMLElement, step: ReviewStep, items: readonly ActionItem[], now: Date): void {
		const r = STRINGS.review;
		const q = question(body, r.questions.next);
		if (step.next.length) this.cards(q.createDiv({ cls: 'mtm-stack' }), step.next, now);
		if (!step.next.length && !step.nextAbove.length) {
			// Nothing in the next-step status: the ghost card, as on the board.
			const ghost = pressable(q.createDiv({ cls: 'mtm-next-ghost' }), () => this.openQuickAdd(step.matter, items));
			appendIcon(ghost, 'plus');
			ghost.createSpan({ cls: 'mtm-next-ghost-text', text: STRINGS.nextAction.ghost });
			return;
		}
		const row = q.createDiv({ cls: 'mtm-review-row' });
		if (step.nextAbove.length) row.createSpan({ cls: 'mtm-field-hint', text: r.nextAbove(step.nextAbove.map((i) => i.title)) });
		const add = pressable(row.createSpan({ cls: 'mtm-review-all' }), () => this.openQuickAdd(step.matter, items));
		appendIcon(add, 'plus');
		add.appendText(r.newAction);
	}

	/** Dormant Matters: Wake up, Keep dormant, Close, as Process Inbox's decision buttons. */
	private renderDormantChoices(parent: HTMLElement, matter: MatterInfo): void {
		const r = STRINGS.review;
		const grid = parent.createDiv({ cls: 'mtm-review-choices' });
		const current = matter.state;
		for (const [key, state, icon] of [
			['wake', 'active', 'circle-play'],
			['keep', 'dormant', 'moon'],
			['close', 'closed', 'archive'],
		] as const) {
			const [label, sub] = r.dormant[key];
			const button = grid.createEl('button', { cls: ['mtm-decision', ...(current === state ? ['is-active'] : [])] });
			tileEl(button, icon, 'mod-neutral');
			const text = button.createSpan({ cls: 'mtm-decision-text' });
			text.createSpan({ cls: 'mtm-decision-label', text: label });
			text.createSpan({ cls: 'mtm-decision-sub', text: sub });
			button.addEventListener('click', () => {
				if (current !== state) this.setState(matter, state);
			});
		}
	}

	private renderEnd(): void {
		const r = STRINGS.review;
		const { contentEl } = this;
		const now = new Date();
		const today = toYmd(now);
		const total = this.queue.length;
		renderBar(contentEl, { position: total, total, done: total });

		const zero = contentEl.createDiv({ cls: 'mtm-process-zero' });
		const matters = new Map(this.matters().map((m) => [m.path, m]));
		const filed = this.reviewed.map((p) => matters.get(p)).filter((m): m is MatterInfo => !!m);
		if (filed.length) {
			const stack = zero.createDiv({ cls: 'mtm-empty-stack' });
			for (const m of filed.slice(-END_STACK)) {
				const card = stack.createDiv({ cls: 'mtm-card' });
				const head = card.createDiv({ cls: 'mtm-card-head' });
				tileEl(head, m.icon, 'mod-neutral');
				head.createDiv({ cls: 'mtm-card-title', text: m.name });
				appendIcon(head.createSpan({ cls: 'mtm-card-check' }), 'circle-check');
			}
		}
		const left = this.tally.skipped;
		zero.createEl('h2', { cls: 'mtm-process-zero-title', text: left ? r.leftTitle(left) : r.allTitle });
		zero.createEl('p', { cls: 'mtm-process-zero-text', text: left ? r.leftText : r.allText });
		renderTally(zero, this.tally);

		const withNext = filed.filter((m) => m.review?.cadence);
		if (withNext.length) {
			const next = zero.createDiv({ cls: 'mtm-review-next' });
			next.createDiv({ cls: 'mtm-section-title', text: r.nextReviews });
			// Reviewed today, so the next review is today plus the rhythm (the cache may not have the new date yet).
			const dated = withNext.map((m) => ({ m, date: nextReview(m.review?.cadence ?? null, today) ?? today })).sort((a, b) => a.date.localeCompare(b.date));
			for (const { m, date } of dated) {
				const row = next.createDiv({ cls: 'mtm-review-next-row' });
				appendIcon(row.createSpan({ cls: 'mtm-matter-icon' }), m.icon);
				row.createEl('b', { text: m.name });
				row.createSpan({ text: dayLabel(date, today) });
			}
		}

		const waits = longWaitsAcross(allActionItems(this.app, this.settings), now).slice(0, END_WAITS);
		if (waits.length) {
			const section = zero.createDiv({ cls: 'mtm-review-waits' });
			section.createDiv({ cls: 'mtm-section-title', text: r.longWaits });
			this.cards(section.createDiv({ cls: 'mtm-stack' }), waits, now, true);
		}

		const actions = zero.createDiv({ cls: 'mtm-board-empty-actions' });
		actions.createEl('button', { cls: 'mod-cta', text: r.openBoard }).addEventListener('click', () => {
			this.close();
			void this.plugin.openBoard();
		});
		actions.createEl('button', { text: r.close }).addEventListener('click', () => this.close());
	}
}

/** The header, then "Since …: n done" (not for dormant Matters). */
function renderHeadAndSince(parent: HTMLElement, step: ReviewStep, spheres: Parameters<typeof renderHead>[2], today: string): void {
	const r = STRINGS.review;
	renderHead(parent, step.matter, spheres, today);
	if (step.dormant) return;
	const since = parent.createDiv({ cls: 'mtm-review-since' });
	appendIcon(since, 'history');
	const from = step.sinceReview ? r.sinceReview(dayLabel(step.since, today)) : r.sinceWindow;
	since.createSpan({ text: `${from}: ${r.done(step.doneSince.map((i) => i.title))}` });
}
