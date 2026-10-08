// Registers the board, list, calendar and timeline as custom Bases views.

import type { BasesAllOptions } from 'obsidian';
import type MattersPlugin from '../../main';
import { STRINGS } from '../../strings';
import { VIEW_TYPES, type CollectionView } from '../../services/baseFile';
import { BoardView } from './board/boardView';
import { OPTION_KEYS } from './collectionView';
import { ListView } from './list/listView';
import { CalendarView } from './calendar/calendarView';
import { TimelineView } from './timeline/timelineView';

const ICONS: Record<CollectionView, string> = {
	board: 'square-kanban',
	list: 'list',
	calendar: 'calendar',
	timeline: 'chart-gantt',
};


function doneOptions(): BasesAllOptions[] {
	const o = STRINGS.views.options;
	return [
		{
			type: 'dropdown',
			key: OPTION_KEYS.showDone,
			displayName: o.showDone,
			default: 'inherit',
			options: { inherit: o.inherit, show: o.show, hide: o.hide },
		},
		{ type: 'slider', key: OPTION_KEYS.doneDays, displayName: o.doneDays, default: 0, min: 0, max: 90, step: 1 },
	];
}

function inboxOption(): BasesAllOptions {
	const o = STRINGS.views.options;
	return {
		type: 'dropdown',
		key: OPTION_KEYS.inboxPosition,
		displayName: o.inboxPosition,
		default: 'inherit',
		options: { inherit: o.inherit, top: o.first, bottom: o.last, hidden: o.hidden },
	};
}

function boardOptions(): BasesAllOptions[] {
	const o = STRINGS.views.options;
	return [inboxOption(), ...doneOptions(), { type: 'toggle', key: OPTION_KEYS.hideEmptyLanes, displayName: o.hideEmptyLanes, default: false }];
}

/** The list and timeline never show empty Matters, so they have no "Hide empty lanes". */
function listOptions(): BasesAllOptions[] {
	return [inboxOption(), ...doneOptions()];
}

/** Returns false when the Bases core plugin is off. */
export function registerCollectionViews(plugin: MattersPlugin): boolean {
	let ok = true;
	for (const key of Object.keys(VIEW_TYPES) as CollectionView[]) {
		const type = VIEW_TYPES[key];
		const registered = plugin.registerBasesView(type, {
			name: STRINGS.views[key],
			icon: ICONS[key],
			factory: (controller, containerEl) =>
				key === 'board'
					? new BoardView(controller, containerEl, plugin)
					: key === 'list'
						? new ListView(controller, containerEl, plugin)
						: key === 'calendar'
							? new CalendarView(controller, containerEl, plugin)
							: new TimelineView(controller, containerEl, plugin),
			options: key === 'board' ? boardOptions : key === 'calendar' ? doneOptions : listOptions,
		});
		ok &&= registered;
	}
	return ok;
}
