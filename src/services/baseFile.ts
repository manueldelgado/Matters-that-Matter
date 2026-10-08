// The .base file hosting the collection views.

export const VIEW_TYPES = {
	board: 'mtm-board',
	list: 'mtm-list',
	calendar: 'mtm-calendar',
	timeline: 'mtm-timeline',
} as const;

export type CollectionView = keyof typeof VIEW_TYPES;

/**
 * Bases query for Actions. Hyphenated keys need the bracket form: the bare form
 * (`mtm-kind == "action"`) silently matches nothing.
 */
export const ACTIONS_FILTER = 'note["mtm-kind"] == "action"';

const quote = (value: string) => JSON.stringify(value);

/**
 * The four views, then a list of what can be done next: grouped by type, without the backlog status,
 * the Inbox or done Actions. Option keys are the views' own (see OPTION_KEYS in the views).
 */
export function boardBaseContent(names: Record<CollectionView | 'nextActions', string>): string {
	const views = (Object.keys(VIEW_TYPES) as CollectionView[])
		.map((key) => `  - type: ${VIEW_TYPES[key]}\n    name: ${quote(names[key])}\n`)
		.join('');
	const nextActions =
		`  - type: ${VIEW_TYPES.list}\n    name: ${quote(names.nextActions)}\n` +
		'    mtmGroupBy: type\n    mtmShowBacklog: false\n    mtmInboxPosition: hidden\n    mtmShowDone: hide\n';
	return `filters:\n  and:\n    - ${quote(ACTIONS_FILTER)}\nviews:\n${views}${nextActions}`;
}
