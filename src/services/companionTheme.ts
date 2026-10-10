// The companion theme, Calm Matters: its name, the link that opens it in Obsidian's theme browser,
// and whether it is the active theme. Pure: the current theme's name is read elsewhere.

/** The theme's name in Obsidian's theme browser, and its folder in `.obsidian/themes/`. */
export const COMPANION_THEME = 'Calm Matters';

/** The obsidian:// link that opens the theme browser at the companion theme. */
export function companionThemeUri(): string {
	return `obsidian://show-theme?name=${encodeURIComponent(COMPANION_THEME)}`;
}

/** Whether the companion theme is active: null when the current theme couldn't be read. */
export function usesCompanionTheme(current: string | null): boolean | null {
	if (current === null) return null;
	return current === COMPANION_THEME;
}
