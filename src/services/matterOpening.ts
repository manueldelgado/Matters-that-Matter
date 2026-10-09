// Matters open as their overview: what a tab should show when asked to show a note.
// Pure; the hook that applies it lives in vault/internal.ts.

export interface OpenContext {
	/** The setting "Open Matters as their overview". */
	enabled: boolean;
	isMatter(path: string): boolean;
	/** The Matter this tab was asked to show as a note ("Open note"), if any. */
	notePath: string | null;
}

export interface OpenDecision {
	/** Show this Matter's overview instead of its note; null to let the request through. */
	overview: string | null;
	/** Whether the tab still shows its Matter as a note afterwards. */
	keepNote: boolean;
}

/**
 * A request to show a Matter note becomes its overview, unless the tab was asked to show that note as a note.
 * Showing anything else in the tab ends that note mode, so the Matter opens as its overview there next time.
 */
export function matterOpenDecision(type: string, file: unknown, ctx: OpenContext): OpenDecision {
	if (type !== 'markdown' || typeof file !== 'string') return { overview: null, keepNote: false };
	if (file === ctx.notePath) return { overview: null, keepNote: true };
	return { overview: ctx.enabled && ctx.isMatter(file) ? file : null, keepNote: false };
}
