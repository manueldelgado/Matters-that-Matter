// The pickers behind the "Reviews due" and "Waiting" counts in a new tab.

import { FuzzySuggestModal, type App } from 'obsidian';
import { STRINGS } from '../../strings';
import { toYmd } from '../../model/dates';
import { waitAge } from '../../model/actions';
import type { ActionItem } from '../../services/actionItems';
import type { MatterInfo } from '../../services/boardModel';

/** Matters due for review, most overdue first; choosing one opens its overview. */
export class ReviewPicker extends FuzzySuggestModal<MatterInfo> {
	constructor(
		app: App,
		private matters: readonly MatterInfo[],
		private onPick: (matter: MatterInfo) => void,
	) {
		super(app);
		this.setPlaceholder(STRINGS.today.reviewPlaceholder);
	}

	getItems(): MatterInfo[] {
		return [...this.matters];
	}

	getItemText(matter: MatterInfo): string {
		const days = matter.review?.daysSince;
		return days === null || days === undefined ? `${matter.name} · ${STRINGS.board.neverReviewed}` : `${matter.name} · ${STRINGS.board.reviewedAgo(days)}`;
	}

	onChooseItem(matter: MatterInfo): void {
		this.onPick(matter);
	}
}

/** Actions waiting on someone, the longest wait first; choosing one selects it. */
export class WaitingPicker extends FuzzySuggestModal<ActionItem> {
	constructor(
		app: App,
		private items: readonly ActionItem[],
		private now: Date,
		private onPick: (item: ActionItem) => void,
	) {
		super(app);
		this.setPlaceholder(STRINGS.today.waitingPlaceholder);
	}

	getItems(): ActionItem[] {
		return [...this.items];
	}

	getItemText(item: ActionItem): string {
		const who = item.waitingOn ?? '';
		const age = item.waitingSince ? ` · ${waitAge(item.waitingSince, toYmd(this.now)).long}` : '';
		return `${item.title} · ${who}${age}`;
	}

	onChooseItem(item: ActionItem): void {
		this.onPick(item);
	}
}
