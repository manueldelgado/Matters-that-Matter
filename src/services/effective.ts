// Effective values and orphan detection. Pure: computes what views show, never writes.
//
// Absent values fall back silently; present but invalid values fall back with an orphan badge
// that shows the raw value. The note keeps the raw value until the user acts.

import type { MattersSettings, StatusCategory, StatusDef, TypeDef } from '../settings';
import { backlogStatus, defaultType } from '../model/workflow';

/** What a link resolves to; null when it does not resolve. */
export interface ResolvedLink {
	path: string;
	isMatter: boolean;
}

export type ResolveLink = (linktext: string) => ResolvedLink | null;

export interface EffectiveAction {
	status: StatusDef;
	category: StatusCategory;
	type: TypeDef;
	/** Path of the Matter note; the Inbox when absent or invalid. */
	matterPath: string;
	/** Raw values of invalid fields, as shown on badges. Empty when the Action is not orphaned. */
	orphans: Partial<Record<'status' | 'type' | 'matter', string>>;
}

export type WorkflowSettings = Pick<MattersSettings, 'statuses' | 'types' | 'inboxPath'>;

export function isAbsent(raw: unknown): boolean {
	return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
}

/** The raw value as text for a badge. */
export function rawText(raw: unknown): string {
	if (typeof raw === 'string') return raw;
	if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
	return JSON.stringify(raw) ?? '';
}

/**
 * The link text of a frontmatter link: "[[Kitchen|K]]" → "Kitchen", "[[Kitchen#Plan]]" → "Kitchen".
 * Plain text is accepted as link text too. Lists and other values give null.
 */
export function linkText(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const value = raw.trim();
	const m = /^\[\[([^\]]*)\]\]$/.exec(value);
	const inner = (m ? m[1] ?? '' : value).split('|')[0] ?? '';
	const target = inner.split(/[#^]/)[0]?.trim() ?? '';
	return target || null;
}

export function effectiveAction(
	fm: Readonly<Record<string, unknown>> | null | undefined,
	settings: WorkflowSettings,
	resolve: ResolveLink,
): EffectiveAction {
	const orphans: EffectiveAction['orphans'] = {};
	const raw = fm ?? {};

	const fallbackStatus = backlogStatus(settings.statuses) ?? settings.statuses[0];
	const fallbackType = defaultType(settings.types) ?? settings.types[0];
	if (!fallbackStatus || !fallbackType) throw new Error('The workflow has no statuses or no types');

	const rawStatus = raw['mtm-status'];
	let status = fallbackStatus;
	if (!isAbsent(rawStatus)) {
		const found = settings.statuses.find((s) => s.id === rawStatus);
		if (found) status = found;
		else orphans.status = rawText(rawStatus);
	}

	const rawType = raw['mtm-type'];
	let type = fallbackType;
	if (!isAbsent(rawType)) {
		const found = settings.types.find((t) => t.id === rawType);
		if (found) type = found;
		else orphans.type = rawText(rawType);
	}

	const rawMatter = raw['mtm-matter'];
	let matterPath = settings.inboxPath;
	if (!isAbsent(rawMatter)) {
		const text = linkText(rawMatter);
		const target = text === null ? null : resolve(text);
		if (target && (target.isMatter || target.path === settings.inboxPath)) matterPath = target.path;
		else orphans.matter = rawText(rawMatter);
	}

	return { status, category: status.category, type, matterPath, orphans };
}

export function isOrphan(action: EffectiveAction): boolean {
	return Object.keys(action.orphans).length > 0;
}

/**
 * The frontmatter "Fix orphaned Actions" and "Dismiss" write: the fallback for each invalid field.
 * Link values are left to the caller, which knows the shortest link text for the Inbox.
 */
export function fallbackWrites(action: EffectiveAction): { status?: string; type?: string; matterToInbox?: true } {
	const out: { status?: string; type?: string; matterToInbox?: true } = {};
	if (action.orphans.status !== undefined) out.status = action.status.id;
	if (action.orphans.type !== undefined) out.type = action.type.id;
	if (action.orphans.matter !== undefined) out.matterToInbox = true;
	return out;
}
