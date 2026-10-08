// Undocumented Obsidian internals, isolated and guarded. Every function degrades to a no-op
// or null when the internal shape changes.

import type { App, View } from 'obsidian';

type Fn = (...args: unknown[]) => unknown;

function method(owner: unknown, name: string): Fn | null {
	if (typeof owner !== 'object' || owner === null) return null;
	const fn = (owner as Record<string, unknown>)[name];
	return typeof fn === 'function' ? (fn as Fn).bind(owner) : null;
}

/** Keys holding 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'. Obsidian would infer "date" from date-only values. */
const DATETIME_KEYS = ['mtm-start', 'mtm-due'];

/** Sets the date keys to the datetime property type when no type is assigned yet. */
export function ensureDateTimeTypes(app: App): void {
	try {
		const manager = (app as unknown as Record<string, unknown>).metadataTypeManager;
		const getAssigned = method(manager, 'getAssignedWidget');
		const setType = method(manager, 'setType');
		if (!getAssigned || !setType) return;
		for (const key of DATETIME_KEYS) {
			if (getAssigned(key) == null) void setType(key, 'datetime');
		}
	} catch (e) {
		console.warn('Matters that Matter: could not set property types', e);
	}
}

/** The "Automatically update internal links" setting, or null if it cannot be read. */
export function alwaysUpdateLinks(app: App): boolean | null {
	try {
		const getConfig = method(app.vault, 'getConfig');
		const value = getConfig?.('alwaysUpdateLinks');
		return typeof value === 'boolean' ? value : null;
	} catch {
		return null;
	}
}

/** Opens a tab of Obsidian's settings ("file" is Files and links). Returns false if it cannot. */
export function openSettingsTab(app: App, tabId: string): boolean {
	try {
		const setting = (app as unknown as Record<string, unknown>).setting;
		const open = method(setting, 'open');
		const openTab = method(setting, 'openTabById');
		if (!open || !openTab) return false;
		open();
		openTab(tabId);
		return true;
	} catch {
		return false;
	}
}

/**
 * Refreshes a view's tab and header title after its state changes (an ItemView's header title is set only
 * when the view loads). No-op if the internals change.
 */
export function refreshViewTitle(view: View): void {
	try {
		method(view.leaf, 'updateHeader')?.();
		const title = (view as unknown as Record<string, unknown>).titleEl;
		if (title instanceof HTMLElement) title.setText(view.getDisplayText());
	} catch (e) {
		console.warn('Matters that Matter: could not refresh the view title', e);
	}
}
