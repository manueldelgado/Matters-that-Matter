// The notice that confirms an added Action: its type, title and where it went. Clicking it selects the Action.

import { Notice } from 'obsidian';
import type MattersPlugin from '../../main';
import type { TypeDef } from '../../settings';
import { STRINGS } from '../../strings';
import { appendIcon, tileEl, typeClasses } from './dom';

export interface AddedAction {
	path: string;
	title: string;
	type: TypeDef | undefined;
	/** The Matter's name and the status's label. */
	matter: string;
	status: string;
	/** Where it came from when it wasn't typed in Matters ("From a link"). */
	source?: string;
}

export function showAddedNotice(plugin: MattersPlugin, added: AddedAction): void {
	const { type } = added;
	const fragment = createFragment((f) => {
		const row = f.createDiv({ cls: ['mtm-added', ...(type ? typeClasses(type) : [])] });
		if (type) tileEl(row, type.icon, 'mod-sm');
		const text = row.createSpan({ cls: 'mtm-added-text' });
		if (added.source) {
			const source = text.createSpan({ cls: 'mtm-added-source' });
			appendIcon(source, 'link');
			source.appendText(added.source);
		}
		text.createSpan({ cls: 'mtm-added-title', text: added.title });
		text.createSpan({ cls: 'mtm-added-dest', text: STRINGS.quickAdd.added(added.matter, added.status) });
	});
	const notice = new Notice(fragment, 6000);
	notice.messageEl.addEventListener('click', () => void plugin.selectAction(added.path));
}
