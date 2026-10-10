// The settings tab's built-in controls (toggles and dropdowns) and the settings they read and write.
// Pure, so every control is tested. Folder controls stay in the tab: they need Obsidian's normalizePath.

import { DATE_LANGUAGES, type DateLanguage, type MattersSettings } from '../settings';

/** What applying a control's value did: changed the settings, refused the value (nothing changed), or found no control by that key. */
export type ControlResult = 'applied' | 'refused' | 'unknown';

interface ControlMapping {
	/** The value the control shows. */
	read(settings: MattersSettings): unknown;
	/**
	 * Writes the control's value into the settings, coercing anything unexpected to a valid value.
	 * Returns 'refused', changing nothing, when the value would leave the settings invalid.
	 */
	apply(settings: MattersSettings, value: unknown): 'applied' | 'refused' | void;
}

/** A toggle for one date language. Turning off the last language on is refused: quick add needs one. */
function dateLanguage(lang: DateLanguage): ControlMapping {
	return {
		read: (s) => s.dateLanguages.includes(lang),
		apply: (s, v) => {
			const on = v === true;
			const next = DATE_LANGUAGES.filter((l) => (l === lang ? on : s.dateLanguages.includes(l)));
			if (!next.length) return 'refused';
			s.dateLanguages = next;
			return 'applied';
		},
	};
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
	datesEnglish: dateLanguage('en'),
	datesSpanish: dateLanguage('es'),
} satisfies Record<string, ControlMapping>;

export type ControlKey = keyof typeof CONTROLS;

/** Every key a control in the settings tab may use (built-in controls, and the date language toggles' render rows). */
export const CONTROL_KEYS = Object.keys(CONTROLS) as readonly ControlKey[];

export function isControlKey(key: string): key is ControlKey {
	return Object.prototype.hasOwnProperty.call(CONTROLS, key);
}

/** The value a control shows; undefined for a key that isn't a control. */
export function readControlValue(settings: MattersSettings, key: string): unknown {
	return isControlKey(key) ? CONTROLS[key].read(settings) : undefined;
}

/**
 * Writes a control's value into the settings. Returns 'refused' when the control turns the value down
 * and 'unknown' for a key that isn't a control; neither changes anything.
 */
export function applyControlValue(settings: MattersSettings, key: string, value: unknown): ControlResult {
	if (!isControlKey(key)) return 'unknown';
	return CONTROLS[key].apply(settings, value) === 'refused' ? 'refused' : 'applied';
}
