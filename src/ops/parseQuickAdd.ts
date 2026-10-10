// Parse quick add text without writing: what adding it would make, with a warning for every name that matched nothing.

import { draftOf } from '../services/quickAdd';
import { fallbacks, readText, readiness } from './fields';
import { emptyPlan } from './plan';
import { parseText, tokenWarnings } from './quickAddText';
import { matterName } from './summaries';
import type { OpResult, ParsedQuickAdd, Snapshot } from './types';
import { baseName } from './vaultView';

export function parseQuickAdd(text: string, s: Snapshot): OpResult<ParsedQuickAdd> {
	const ready = readiness(s, false);
	if (ready.error) return { ok: false, error: ready.error };
	const t = readText('text', text);
	if (!t.ok) return t;
	const { settings } = s;
	const { backlog, fallbackType } = fallbacks(s);
	const result = parseText(t.value, s);
	const draft = draftOf(result, { contextMatter: null, contextStatus: null, pickedType: null, inboxPath: settings.inboxPath, backlogId: backlog.id, defaultTypeId: fallbackType.id });
	const type = settings.types.find((x) => x.id === draft.typeId) ?? fallbackType;

	const value: ParsedQuickAdd = {
		title: draft.title,
		status: { id: backlog.id, label: backlog.label },
		type: { id: type.id, label: type.label, isDefault: result.typeId === null },
		matter: { path: draft.matterPath, name: matterName(draft.matterPath, s), isDefault: draft.matterIsDefault },
		people: draft.people.map((p) => ({ path: p, name: baseName(p) })),
		priority: draft.priority,
		start: draft.start,
		due: draft.due,
		chips: result.chips.map((c) => ({
			kind: c.kind,
			text: c.text,
			valid: c.kind === 'type' ? c.id !== null : c.kind === 'matter' || c.kind === 'person' ? c.path !== null : true,
		})),
	};
	const warnings = [...ready.warnings, ...tokenWarnings(result, { type: false, matter: false, people: false }, fallbackType.label, false)];
	return { ok: true, value, plan: emptyPlan(), changes: [], warnings };
}
