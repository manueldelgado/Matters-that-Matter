// The settings tab's built-in controls (toggles and dropdowns) and the settings they read and write.
// Pure, so every control is tested. Folder controls stay in the tab: they need Obsidian's normalizePath.

import type { MattersSettings } from '../settings';

interface ControlMapping {
	/** The value the control shows. */
	read(settings: MattersSettings): unknown;
	/** Writes the control's value into the settings, coercing anything unexpected to a valid value. */
	apply(settings: MattersSettings, value: unknown): void;
}

/** One entry per control key. A key can name a setting or be virtual (mapping onto part of one). */
const CONTROLS = {
	defaultInboxPosition: {
		read: (s) => s.defaultInboxPosition,
		apply: (s, v) => void (s.defaultInboxPosition = v === 'bottom' ? 'bottom' : 'top'),
	},
	showDone: {
		read: (s) => s.showDone,
		apply: (s, v) => void (s.showDone = v === true),
	},
	weekStart: {
		read: (s) => s.weekStart,
		apply: (s, v) => void (s.weekStart = v === 'sunday' ? 'sunday' : 'monday'),
	},
	openMattersAsOverview: {
		read: (s) => s.openMattersAsOverview,
		apply: (s, v) => void (s.openMattersAsOverview = v === true),
	},
	inlineChips: {
		read: (s) => s.inlineChips,
		apply: (s, v) => void (s.inlineChips = v === true),
	},
	todayInNewTabs: {
		read: (s) => s.todayInNewTabs,
		apply: (s, v) => void (s.todayInNewTabs = v === 'alone' || v === 'off' ? v : 'every'),
	},
} satisfies Record<string, ControlMapping>;

export type ControlKey = keyof typeof CONTROLS;

/** Every key a built-in control in the settings tab may use. */
export const CONTROL_KEYS = Object.keys(CONTROLS) as readonly ControlKey[];

export function isControlKey(key: string): key is ControlKey {
	return Object.prototype.hasOwnProperty.call(CONTROLS, key);
}

/** The value a control shows; undefined for a key that isn't a control. */
export function readControlValue(settings: MattersSettings, key: string): unknown {
	return isControlKey(key) ? CONTROLS[key].read(settings) : undefined;
}

/** Writes a control's value into the settings. Returns false, changing nothing, for a key that isn't a control. */
export function applyControlValue(settings: MattersSettings, key: string, value: unknown): boolean {
	if (!isControlKey(key)) return false;
	CONTROLS[key].apply(settings, value);
	return true;
}
