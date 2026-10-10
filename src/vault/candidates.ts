// What quick add tokens can name: types, Matters and people. Shared by quick add and Process Inbox.

import { normalizePath, type App } from 'obsidian';
import type { MattersSettings } from '../settings';
import { STRINGS } from '../strings';
import { toYmd } from '../model/dates';
import type { TypeCandidate } from '../services/quickAddParser';
import { personCandidates, type PersonCandidate } from '../services/notesModel';
import type { MatterCandidate } from '../ui/modals/quickAdd/quickAddRender';
import { now } from './clock';
import { allActionItems, allMatters, noteData } from './index';

export interface Candidates {
	types: TypeCandidate[];
	matters: MatterCandidate[];
	people: PersonCandidate[];
}

export function loadCandidates(app: App, s: MattersSettings): Candidates {
	const today = toYmd(now());
	const types = s.types.map((t) => ({ id: t.id, names: [t.label, t.id] }));

	const open = new Map<string, number>();
	for (const item of allActionItems(app, s)) {
		if (item.category !== 'closed') open.set(item.effective.matterPath, (open.get(item.effective.matterPath) ?? 0) + 1);
	}
	const q = STRINGS.quickAdd;
	const matters = allMatters(app, s, today).map((m) => ({
		path: m.path,
		name: m.name,
		names: [m.name],
		icon: m.icon,
		// The Inbox first among equal matches.
		rank: m.isInbox ? 0 : 1,
		meta: m.state === 'closed' ? q.closed : m.state === 'dormant' ? q.dormant : open.get(m.path) ? q.open(open.get(m.path) ?? 0) : '',
	}));

	// People are ordinary notes; Actions and Matters are never people.
	const people = personCandidates(
		app.vault.getMarkdownFiles().map((f) => noteData(app, f)),
		normalizePath(s.folders.people),
	);
	return { types, matters, people };
}
