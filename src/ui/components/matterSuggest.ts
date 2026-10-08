// A Matter field: fuzzy suggestions under a text input, with "New Matter …" when nothing matches exactly.

import { AbstractInputSuggest, type App } from 'obsidian';
import { appendIcon } from './dom';
import { STRINGS } from '../../strings';
import { sanitiseTitle } from '../../model/titles';
import { normalise, rank } from '../../services/fuzzy';
import type { MatterCandidate } from '../modals/quickAdd/quickAddRender';

export type MatterChoice = { kind: 'matter'; item: MatterCandidate } | { kind: 'new'; name: string };

const LIMIT = 8;

export class MatterSuggest extends AbstractInputSuggest<MatterChoice> {
	constructor(
		app: App,
		private input: HTMLInputElement,
		private candidates: readonly MatterCandidate[],
		private onPick: (choice: MatterChoice) => void,
	) {
		super(app, input);
		this.limit = LIMIT + 1;
	}

	protected getSuggestions(query: string): MatterChoice[] {
		const q = query.trim();
		const found: MatterChoice[] = (q ? rank(q, this.candidates).map((r) => r.item) : [...this.candidates])
			.slice(0, LIMIT)
			.map((item) => ({ kind: 'matter', item }));
		const name = sanitiseTitle(q);
		if (name && !this.candidates.some((c) => normalise(c.name) === normalise(name))) found.push({ kind: 'new', name });
		return found;
	}

	renderSuggestion(choice: MatterChoice, el: HTMLElement): void {
		el.addClass('mtm-suggest-item');
		if (choice.kind === 'new') {
			el.addClass('mtm-suggest-new');
			appendIcon(el, 'plus');
			el.createSpan({ text: STRINGS.process.newMatter(choice.name) });
			return;
		}
		appendIcon(el, choice.item.icon);
		el.createSpan({ text: choice.item.name });
		if (choice.item.meta) el.createSpan({ cls: 'mtm-suggest-meta', text: choice.item.meta });
	}

	selectSuggestion(choice: MatterChoice): void {
		this.input.value = choice.kind === 'new' ? choice.name : choice.item.name;
		this.onPick(choice);
		this.close();
	}
}
