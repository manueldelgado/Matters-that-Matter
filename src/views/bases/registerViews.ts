// Registers the board, list, calendar and timeline as custom Bases views.
// List, calendar and timeline are placeholders until each one is built.

import { BasesView, type BasesAllOptions, type QueryController } from 'obsidian';
import type MattersPlugin from '../../main';
import { STRINGS } from '../../strings';
import { VIEW_TYPES, type CollectionView } from '../../services/baseFile';
import { BoardView } from './board/boardView';

const ICONS: Record<CollectionView, string> = {
	board: 'square-kanban',
	list: 'list',
	calendar: 'calendar',
	timeline: 'chart-gantt',
};

/** Option keys stored in the .base view config. */
export const OPTION_KEYS = {
	inboxPosition: 'mtmInboxPosition',
	showDone: 'mtmShowDone',
	doneDays: 'mtmDoneDays',
	hideEmptyLanes: 'mtmHideEmptyLanes',
} as const;

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

function boardOptions(): BasesAllOptions[] {
	const o = STRINGS.views.options;
	return [
		{
			type: 'dropdown',
			key: OPTION_KEYS.inboxPosition,
			displayName: o.inboxPosition,
			default: 'inherit',
			options: { inherit: o.inherit, top: o.first, bottom: o.last, hidden: o.hidden },
		},
		...doneOptions(),
		{ type: 'toggle', key: OPTION_KEYS.hideEmptyLanes, displayName: o.hideEmptyLanes, default: false },
	];
}

class PlaceholderView extends BasesView {
	constructor(
		controller: QueryController,
		private containerEl: HTMLElement,
		readonly type: string,
	) {
		super(controller);
	}

	onDataUpdated(): void {
		this.containerEl.empty();
		this.containerEl.createDiv({ cls: 'mtm-view' }).createDiv({ cls: 'mtm-empty', text: STRINGS.views.placeholder });
	}
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
				key === 'board' ? new BoardView(controller, containerEl, plugin) : new PlaceholderView(controller, containerEl, type),
			options: key === 'board' ? boardOptions : doneOptions,
		});
		ok &&= registered;
	}
	return ok;
}
