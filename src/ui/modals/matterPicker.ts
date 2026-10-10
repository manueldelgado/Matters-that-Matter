// Picks a Matter to move an Action to (the swipe board's "Move to Matter…").

import { FuzzySuggestModal, setIcon, type App, type FuzzyMatch } from 'obsidian';
import { STRINGS } from '../../strings';
import type { MatterInfo } from '../../services/boardModel';

export class MatterPicker extends FuzzySuggestModal<MatterInfo> {
	constructor(
		app: App,
		private matters: readonly MatterInfo[],
		private onPick: (matter: MatterInfo) => void,
	) {
		super(app);
		this.setPlaceholder(STRINGS.swipe.moveToPlaceholder);
	}

	getItems(): MatterInfo[] {
		return [...this.matters];
	}

	getItemText(matter: MatterInfo): string {
		return matter.name;
	}

	renderSuggestion(match: FuzzyMatch<MatterInfo>, el: HTMLElement): void {
		el.addClass('mtm-suggest-matter');
		setIcon(el.createSpan({ cls: 'mtm-matter-icon' }), match.item.icon);
		super.renderSuggestion(match, el.createSpan());
	}

	onChooseItem(matter: MatterInfo): void {
		this.onPick(matter);
	}
}
