// The companion theme, Calm Matters: a card on setup's Summary step and a row in the settings tab.
// The button opens Obsidian's own theme browser at the theme; the plugin never installs or switches a theme.

import type { App } from 'obsidian';
import { STRINGS } from '../../strings';
import { COMPANION_THEME, companionThemeUri, usesCompanionTheme } from '../../services/companionTheme';
import { currentThemeName, showThemeInBrowser } from '../../vault/internal';
import { appendIcon } from './dom';

/** Whether Calm Matters is the active theme; null when Obsidian doesn't say. */
export function companionThemeActive(app: App): boolean | null {
	return usesCompanionTheme(currentThemeName(app));
}

/** Opens the theme browser at Calm Matters, falling back to the obsidian:// link. */
export function openCompanionTheme(app: App): void {
	if (!showThemeInBrowser(app, COMPANION_THEME)) window.open(companionThemeUri());
}

/** The setup card: a picture of the themed board and the button, or one quiet line when the theme is in use. */
export function renderThemeOffer(parent: HTMLElement, app: App): void {
	const t = STRINGS.companionTheme;
	if (companionThemeActive(app) === true) {
		const line = parent.createDiv({ cls: ['mtm-theme-offer', 'is-active'] });
		appendIcon(line, 'circle-check');
		const text = line.createSpan({ text: t.activeBefore });
		text.createEl('b', { text: t.activeName });
		text.appendText(t.activeAfter);
		return;
	}
	const card = parent.createDiv({ cls: 'mtm-theme-offer' });
	card.createDiv({ cls: 'mtm-theme-offer-shot', attr: { role: 'img', 'aria-label': t.shotLabel } });
	const text = card.createDiv({ cls: 'mtm-theme-offer-text' });
	text.createDiv({ cls: 'mtm-theme-offer-title', text: t.offerTitle });
	text.createDiv({ cls: 'mtm-theme-offer-line', text: t.offerLine });
	const actions = text.createDiv({ cls: 'mtm-theme-offer-actions' });
	const button = actions.createEl('button');
	appendIcon(button, 'palette');
	button.appendText(t.get);
	button.addEventListener('click', () => openCompanionTheme(app));
	actions.createSpan({ cls: 'mtm-theme-offer-note', text: t.note });
}

/** The settings row under the hero, in the same two states. */
export function renderThemeRow(parent: HTMLElement, app: App): void {
	const t = STRINGS.companionTheme;
	const active = companionThemeActive(app) === true;
	const row = parent.createDiv({ cls: ['mtm-settings-theme', ...(active ? ['is-active'] : [])] });
	appendIcon(row, active ? 'circle-check' : 'palette');
	row.createSpan({ text: active ? t.settingsActive : t.settingsOffer });
	if (active) return;
	row.createSpan({ cls: 'mtm-spacer' });
	row.createEl('button', { text: t.settingsGet }).addEventListener('click', () => openCompanionTheme(app));
}
