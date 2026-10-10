// Undocumented Obsidian internals, isolated and guarded. Every function degrades to a no-op
// or null when the internal shape changes.

import { WorkspaceLeaf, type App, type View, type ViewState } from 'obsidian';
import { around } from 'monkey-around';

type Fn = (...args: unknown[]) => unknown;

/** A cross-window element check for an unknown value (Obsidian's internals, event targets). */
export function isHTMLElement(value: unknown): value is HTMLElement {
	return typeof value === 'object' && value !== null && typeof (value as Node).instanceOf === 'function' && (value as Node).instanceOf(HTMLElement);
}

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
		if (isHTMLElement(title)) title.setText(view.getDisplayText());
	} catch (e) {
		console.warn('Matters that Matter: could not refresh the view title', e);
	}
}

/**
 * The title element of a file's entry in every open file explorer. The explorer has no API: its items are read
 * from the view's `fileItems`, else found by `data-path`. Returns nothing if neither works.
 */
export function explorerTitleEls(app: App, path: string): HTMLElement[] {
	const out: HTMLElement[] = [];
	try {
		for (const leaf of app.workspace.getLeavesOfType('file-explorer')) {
			const items = (leaf.view as unknown as Record<string, unknown>).fileItems;
			const item = typeof items === 'object' && items !== null ? (items as Record<string, unknown>)[path] : undefined;
			const self = typeof item === 'object' && item !== null ? (item as Record<string, unknown>).selfEl : undefined;
			if (isHTMLElement(self)) {
				out.push(self);
				continue;
			}
			const found = leaf.view.containerEl.querySelector(`.nav-file-title[data-path="${CSS.escape(path)}"]`);
			if (found?.instanceOf(HTMLElement)) out.push(found);
		}
	} catch (e) {
		console.warn('Matters that Matter: could not read the file explorer', e);
	}
	return out;
}

/**
 * Rewrites the view state a tab is asked to show, before it renders, so a Matter note opens as its overview with no flash
 * and with Back and Forward intact. Wrapping WorkspaceLeaf.setViewState is not a public API: if it fails, tabs open as usual.
 * Returns the uninstaller.
 */
export function rewriteViewStates(rewrite: (leaf: WorkspaceLeaf, state: ViewState) => ViewState): () => void {
	try {
		return around(WorkspaceLeaf.prototype, {
			setViewState(next) {
				return function (this: WorkspaceLeaf, state: ViewState, eState?: unknown) {
					let out = state;
					try {
						out = rewrite(this, state);
					} catch (e) {
						console.warn('Matters that Matter: could not redirect a Matter to its overview', e);
					}
					return next.call(this, out, eState);
				};
			},
		});
	} catch (e) {
		console.warn('Matters that Matter: Matters will open as notes', e);
		return () => {};
	}
}

/** Runs one of Obsidian's commands by ID (New note, Go to file); false when it can't. */
export function runCommand(app: App, id: string): boolean {
	try {
		const run = method((app as unknown as Record<string, unknown>).commands, 'executeCommandById');
		return run ? run(id) === true : false;
	} catch (e) {
		console.warn('Matters that Matter: could not run a command', e);
		return false;
	}
}

/** The active community theme's name ('' for Obsidian's default), or null if it cannot be read. */
export function currentThemeName(app: App): string | null {
	try {
		const customCss = (app as unknown as Record<string, unknown>).customCss;
		const theme = typeof customCss === 'object' && customCss !== null ? (customCss as Record<string, unknown>).theme : undefined;
		return typeof theme === 'string' ? theme : null;
	} catch {
		return null;
	}
}

/**
 * Opens Obsidian's community theme browser at a theme, through the app's own `show-theme` URI handler,
 * so nothing leaves the app. False when the handler can't be found.
 */
export function showThemeInBrowser(app: App, name: string): boolean {
	try {
		const get = method((app.workspace as unknown as Record<string, unknown>).protocolHandlers, 'get');
		const handler = get?.('show-theme');
		if (typeof handler !== 'function') return false;
		(handler as Fn)({ action: 'show-theme', name });
		return true;
	} catch (e) {
		console.warn('Matters that Matter: could not open the theme browser', e);
		return false;
	}
}
