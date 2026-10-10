// The picker behind the "Waiting" count in a new tab. ("Reviews due" opens the review session.)

import { FuzzySuggestModal, type App } from 'obsidian';
import { STRINGS } from '../../strings';
import { toYmd } from '../../model/dates';
import { waitAge } from '../../model/actions';
import type { ActionItem } from '../../services/actionItems';

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
