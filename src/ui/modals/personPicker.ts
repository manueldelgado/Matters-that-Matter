// Picks a person note: notes in the people folder first, then every other note, or "New person …".

import { normalizePath, SuggestModal, TFile, type App } from 'obsidian';
import { STRINGS } from '../../strings';
import { normalise, rank } from '../../services/fuzzy';
import { sanitiseTitle } from '../../model/titles';
import { createPersonNote, frontmatterOf } from '../../vault/notes';

type Choice = { file: TFile; inPeople: boolean } | { create: string };

const LIMIT = 50;

export class PersonPicker extends SuggestModal<Choice> {
	private candidates: { file: TFile; inPeople: boolean; names: string[]; rank: number }[];

	/** `exclude` holds the paths of people already on the Action. */
	constructor(
		app: App,
		private peopleFolder: string,
		exclude: ReadonlySet<string>,
		private onPick: (file: TFile) => void | Promise<void>,
	) {
		super(app);
		const folder = normalizePath(peopleFolder) + '/';
		// People are ordinary notes; Actions and Matters are never people.
		this.candidates = app.vault
			.getMarkdownFiles()
			.filter((f) => !exclude.has(f.path) && frontmatterOf(app, f)?.['mtm-kind'] === undefined)
			.map((file) => {
				const inPeople = file.path.startsWith(folder);
				return { file, inPeople, names: [file.basename], rank: inPeople ? 0 : 1 };
			});
		this.setPlaceholder(STRINGS.inspector.findPerson);
		this.emptyStateText = STRINGS.inspector.personPickerEmpty;
	}

	getSuggestions(query: string): Choice[] {
		const q = query.trim();
		let found: Choice[];
		if (!q) {
			found = this.candidates
				.filter((c) => c.inPeople)
				.sort((a, b) => a.file.basename.localeCompare(b.file.basename))
				.slice(0, LIMIT);
		} else {
			found = rank(q, this.candidates).slice(0, LIMIT).map((r) => r.item);
		}
		const title = sanitiseTitle(q);
		const exact = this.candidates.some((c) => normalise(c.file.basename) === normalise(title));
		if (title && !exact) found.push({ create: title });
		return found;
	}

	renderSuggestion(choice: Choice, el: HTMLElement): void {
		const content = el.createDiv({ cls: 'suggestion-content' });
		if ('create' in choice) {
			content.createDiv({ cls: 'suggestion-title', text: STRINGS.inspector.newPerson(choice.create) });
			content.createDiv({ cls: 'suggestion-note', text: normalizePath(this.peopleFolder) });
			return;
		}
		content.createDiv({ cls: 'suggestion-title', text: choice.file.basename });
		const parent = choice.file.parent?.path;
		if (parent && parent !== '/') content.createDiv({ cls: 'suggestion-note', text: parent });
	}

	onChooseSuggestion(choice: Choice): void {
		if (!('create' in choice)) {
			void this.onPick(choice.file);
			return;
		}
		void createPersonNote(this.app, this.peopleFolder, choice.create).then((file) => this.onPick(file));
	}
}
