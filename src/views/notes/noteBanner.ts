// Banners above the properties of Action and Matter notes. DOM only; the decorator supplies data and handlers.

import { setTooltip } from 'obsidian';
import { STRINGS } from '../../strings';
import type { MatterInfo } from '../../services/boardModel';
import type { ActionItem } from '../../services/actionItems';
import type { BannerDate } from '../../services/noteDecor';
import type { OverviewStats, ReviewState } from '../../services/overviewModel';
import { avatarEl, orphanBanner, priorityEl } from '../../ui/components/card';
import { appendIcon, iconEl, pressable, statusClasses, tileEl, typeClasses } from '../../ui/components/dom';

/** Marks the elements the decorator inserted, so it can find and remove them. */
export const BANNER_ATTR = 'data-mtm-banner';

export interface ActionBannerInput {
	item: ActionItem;
	matter: { name: string; icon: string };
	date: BannerDate | null;
	/** Name of the person in mtm-waiting-on, when waiting. */
	waitingOn: string | null;
}

export interface ActionBannerHandlers {
	typeMenu(anchor: HTMLElement): void;
	statusMenu(anchor: HTMLElement): void;
	openMatter(e: MouseEvent | KeyboardEvent): void;
	toggleDone(): void;
	dismiss(): void;
}

/** The Action banner, followed by the orphan banner when a value is not recognised. */
export function renderActionBanner(input: ActionBannerInput, h: ActionBannerHandlers): HTMLElement[] {
	const s = STRINGS.noteBanner;
	const { item, matter, date } = input;
	const { type, status } = item.effective;
	const closed = item.category === 'closed';

	const banner = createDiv({ cls: ['mtm-note-banner', ...typeClasses(type)], attr: { [BANNER_ATTR]: '' } });
	const tile = pressable(tileEl(banner, type.icon, 'mod-lg'), () => h.typeMenu(tile));
	setTooltip(tile, s.changeType);

	const text = banner.createDiv({ cls: 'mtm-note-banner-text' });
	const typeEl = pressable(text.createSpan({ cls: 'mtm-note-banner-type', text: type.label }), () => h.typeMenu(typeEl));
	appendIcon(typeEl, 'chevron-down');
	setTooltip(typeEl, s.changeType);
	const matterEl = text.createSpan({ cls: 'mtm-note-banner-matter' });
	iconEl(matterEl, matter.icon, 'mtm-matter-icon');
	const link = pressable(matterEl.createEl('a', { cls: 'internal-link', text: matter.name }), (e) => {
		e.preventDefault();
		h.openMatter(e);
	});
	setTooltip(link, s.openMatter);

	const end = banner.createDiv({ cls: 'mtm-note-banner-end' });
	const meta = end.createDiv({ cls: 'mtm-note-banner-meta' });
	if (date) {
		const due = meta.createSpan({ cls: ['mtm-due', 'mod-md', ...(date.state ? [`is-${date.state}`] : [])] });
		appendIcon(due, date.icon);
		due.appendText(date.label);
	}
	if (!closed && item.priority) priorityEl(meta, item.priority);
	if (input.waitingOn) {
		const waiting = meta.createSpan({ cls: 'mtm-waiting' });
		setTooltip(waiting, STRINGS.card.waitingOn(input.waitingOn));
		appendIcon(waiting, 'clock');
		avatarEl(waiting, input.waitingOn);
		waiting.appendText(input.waitingOn.split(/\s+/)[0] ?? '');
	}
	if (!meta.hasChildNodes()) meta.remove();

	// The pill and the circle wrap together.
	const actions = end.createDiv({ cls: 'mtm-note-banner-actions' });
	const pill = pressable(actions.createSpan({ cls: ['mtm-status-pill', ...statusClasses(status)] }), () => h.statusMenu(pill));
	pill.createSpan({ cls: 'mtm-status-dot' });
	pill.appendText(status.label);
	appendIcon(pill, 'chevron-down');
	setTooltip(pill, s.changeStatus);

	// Same element in both states; only the icon and colour change.
	const done = pressable(actions.createDiv({ cls: ['clickable-icon', 'mtm-note-banner-done', ...(closed ? ['is-done'] : [])] }), () => h.toggleDone());
	appendIcon(done, closed ? 'circle-check' : 'circle');
	done.setAttr('aria-label', closed ? s.reopen : s.markDone);

	const out: HTMLElement[] = [banner];
	const orphan = orphanBanner(item.effective, () => h.dismiss());
	if (orphan) {
		orphan.setAttr(BANNER_ATTR, '');
		out.push(orphan);
	}
	return out;
}

export interface MatterBannerInput {
	matter: MatterInfo;
	stats: OverviewStats;
	review: { state: ReviewState; label: string } | null;
}

/** The Matter banner: state, review and counts, with a way into the overview. */
export function renderMatterBanner(input: MatterBannerInput, openOverview: () => void): HTMLElement {
	const s = STRINGS.noteBanner;
	const { matter, stats, review } = input;
	const banner = createDiv({ cls: ['mtm-note-banner', 'mod-matter'], attr: { [BANNER_ATTR]: '' } });
	tileEl(banner, matter.icon, 'mod-lg mod-neutral');

	const text = banner.createDiv({ cls: 'mtm-note-banner-text' });
	text.createSpan({
		cls: 'mtm-note-banner-type',
		text: matter.isInbox ? s.inbox : `${s.matter} · ${STRINGS.overview.states[matter.state]}`,
	});
	if (review) {
		const el = text.createSpan({ cls: ['mtm-review', `is-${review.state}`] });
		appendIcon(el, review.state === 'ontime' ? 'circle-check' : review.state === 'overdue' ? 'alarm-clock' : 'circle-dashed');
		el.appendText(review.label);
	}

	const end = banner.createDiv({ cls: 'mtm-note-banner-end' });
	const counts = end.createDiv({ cls: 'mtm-note-banner-stats' });
	counts.createSpan({ text: s.open(stats.open) });
	if (stats.today) counts.createSpan({ cls: 'mod-late', text: s.late(stats.today) });
	if (stats.waiting) counts.createSpan({ cls: 'mod-waiting', text: s.waiting(stats.waiting) });
	const button = end.createEl('button');
	appendIcon(button, 'layout-dashboard');
	button.appendText(s.openOverview);
	button.addEventListener('click', openOverview);
	return banner;
}
