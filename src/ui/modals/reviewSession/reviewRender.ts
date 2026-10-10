// Review session: the pieces of the modal. DOM only; the modal keeps the state and makes the writes.

import type { SphereDef } from '../../../settings';
import { STRINGS } from '../../../strings';
import type { Ymd } from '../../../model/dates';
import type { MatterInfo } from '../../../services/boardModel';
import { reviewState } from '../../../services/overviewModel';
import { tallyLines, type ReviewTally } from '../../../services/reviewSession';
import { appendIcon, tileEl } from '../../components/dom';
import { STATE_ICONS } from '../../components/matterControls';

/** Eyebrow, and with a total the slim progress bar and "3 of 7". */
export function renderBar(parent: HTMLElement, progress?: { position: number; total: number; done: number }): void {
	const bar = parent.createDiv({ cls: 'mtm-process-bar' });
	const eyebrow = bar.createSpan({ cls: 'mtm-eyebrow' });
	appendIcon(eyebrow, 'rotate-ccw');
	eyebrow.appendText(STRINGS.review.title);
	if (!progress) return;
	const { position, total, done } = progress;
	const track = bar.createDiv({ cls: 'mtm-progress' });
	track.setCssProps({ '--mtm-progress': `${total ? Math.round((done / total) * 100) : 100}%` });
	track.createDiv({ cls: 'mtm-progress-fill' });
	bar.createSpan({ cls: 'mtm-process-count', text: STRINGS.review.count(Math.min(position, total), total) });
}

/** The review label: never reviewed, or when it was last done, in the late colour when due. */
export function reviewLabel(parent: HTMLElement, matter: MatterInfo, today: Ymd, short = false): HTMLElement {
	const r = STRINGS.review;
	const review = matter.review;
	if (!review?.cadence) {
		const el = parent.createSpan({ cls: ['mtm-review', 'is-ontime'] });
		el.setText(r.queueNotDue);
		return el;
	}
	const { state } = reviewState(review, today);
	const el = parent.createSpan({ cls: ['mtm-review', `is-${state}`] });
	appendIcon(el, state === 'ontime' ? 'circle-check' : state === 'overdue' ? 'alarm-clock' : 'circle-dashed');
	const days = review.daysSince;
	if (short) el.appendText(days === null ? r.queueNever : r.queueAgo(days));
	else {
		const base = days === null ? r.neverReviewed : r.lastReviewed(days);
		el.appendText(`${base} · ${r.rhythm(review.cadence.n, review.cadence.unit)}`);
	}
	return el;
}

/** The step's header: the Matter's tile, name, Sphere, state (when dormant) and review label. */
export function renderHead(parent: HTMLElement, matter: MatterInfo, spheres: readonly SphereDef[], today: Ymd): void {
	const head = parent.createDiv({ cls: 'mtm-review-head' });
	tileEl(head, matter.icon, 'mod-lg mod-neutral');
	const main = head.createDiv({ cls: 'mtm-review-head-main' });
	main.createDiv({ cls: 'mtm-review-title', text: matter.name });
	const meta = main.createDiv({ cls: 'mtm-review-meta' });
	if (spheres.length) {
		const sphere = spheres.find((s) => s.id === matter.sphere);
		const chip = meta.createSpan({ cls: ['mtm-sphere-chip', ...(sphere ? [] : ['mod-none'])] });
		appendIcon(chip, sphere?.icon ?? 'circle-dashed');
		chip.appendText(sphere?.label ?? STRINGS.spheres.none);
	}
	if (matter.state !== 'active') {
		const pill = meta.createSpan({ cls: ['mtm-state-pill', `mod-${matter.state}`] });
		appendIcon(pill, STATE_ICONS[matter.state]);
		pill.appendText(STRINGS.overview.states[matter.state]);
	}
	reviewLabel(meta, matter, today);
}

/** One question: its line in the display face, then whatever answers it. */
export function question(parent: HTMLElement, text: string): HTMLElement {
	const el = parent.createDiv({ cls: 'mtm-review-question' });
	el.createDiv({ cls: 'mtm-review-q', text });
	return el;
}

/** The tally as tokens, without zeros. */
export function renderTally(parent: HTMLElement, tally: ReviewTally): void {
	const t = STRINGS.review.tally;
	const icons: Record<keyof ReviewTally, string> = {
		reviewed: 'circle-check',
		nextAdded: 'arrow-right-to-line',
		outcomes: 'flag',
		woken: 'circle-play',
		madeDormant: 'moon',
		closed: 'archive',
		skipped: 'skip-forward',
	};
	const lines = tallyLines(tally);
	if (!lines.length) return;
	const row = parent.createDiv({ cls: 'mtm-process-tally' });
	for (const { key, count } of lines) {
		const token = row.createSpan({ cls: 'mtm-token' });
		appendIcon(token, icons[key]);
		token.appendText(t[key](count));
	}
}
