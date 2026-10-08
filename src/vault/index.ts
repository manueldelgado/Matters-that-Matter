// Builds Action items and Matter lanes from metadataCache.

import { normalizePath, TFile, type App } from 'obsidian';
import type { MattersSettings } from '../settings';
import type { Ymd } from '../model/dates';
import { matterState, parseCadence, parseLaneOrder, parseOutcome, reviewInfo } from '../model/matters';
import { toActionItem, type ActionItem } from '../services/actionItems';
import { linkText, type ResolveLink } from '../services/effective';
import type { MatterInfo } from '../services/boardModel';
import { effectiveSphere } from '../services/spheres';
import { frontmatterOf, notesOfKind } from './notes';

export const DEFAULT_MATTER_ICON = 'circle-dot';

export function resolverFor(app: App, sourcePath: string): ResolveLink {
	return (text) => {
		const file = app.metadataCache.getFirstLinkpathDest(text, sourcePath);
		if (!file) return null;
		return { path: file.path, isMatter: frontmatterOf(app, file)?.['mtm-kind'] === 'matter' };
	};
}

/** The file a frontmatter link value points to. */
export function linkedFile(app: App, raw: unknown, sourcePath: string): TFile | null {
	const text = linkText(raw);
	return text ? app.metadataCache.getFirstLinkpathDest(text, sourcePath) : null;
}

/** Resolved outgoing body links to other notes, without the Matter and people. */
export function linkedNotes(app: App, file: TFile, exclude: ReadonlySet<string>): TFile[] {
	const cache = app.metadataCache.getFileCache(file);
	const out = new Map<string, TFile>();
	for (const link of cache?.links ?? []) {
		const target = app.metadataCache.getFirstLinkpathDest(link.link.split('#')[0] ?? '', file.path);
		if (target && target.extension === 'md' && target.path !== file.path && !exclude.has(target.path)) out.set(target.path, target);
	}
	return [...out.values()];
}

function peoplePaths(app: App, fm: Record<string, unknown>, sourcePath: string): Set<string> {
	const raw = fm['mtm-people'];
	const values: unknown[] = [...(Array.isArray(raw) ? (raw as unknown[]) : [raw]), fm['mtm-waiting-on']];
	const out = new Set<string>();
	for (const v of values) {
		const f = linkedFile(app, v, sourcePath);
		if (f) out.add(f.path);
	}
	return out;
}

export function actionItem(app: App, file: TFile, settings: MattersSettings): ActionItem {
	const fm = frontmatterOf(app, file) ?? {};
	const item = toActionItem(file.path, file.basename, fm, settings, resolverFor(app, file.path));
	const exclude = peoplePaths(app, fm, file.path);
	exclude.add(item.effective.matterPath);
	item.linkedCount = linkedNotes(app, file, exclude).length;
	return item;
}

/** Every Action in the vault (not only those in a Bases result). */
export function allActionItems(app: App, settings: MattersSettings): ActionItem[] {
	return notesOfKind(app, 'action').map((f) => actionItem(app, f, settings));
}

export function matterInfo(app: App, file: TFile, settings: MattersSettings, today: Ymd): MatterInfo {
	const fm = frontmatterOf(app, file) ?? {};
	const isInbox = file.path === settings.inboxPath;
	const icon = typeof fm['mtm-icon'] === 'string' && fm['mtm-icon'].trim() ? fm['mtm-icon'].trim() : DEFAULT_MATTER_ICON;
	const state = isInbox ? 'active' : matterState(fm['mtm-state']);
	const cadence = parseCadence(fm['mtm-review-every']);
	const sphere = effectiveSphere(fm['mtm-sphere'], settings.spheres, isInbox);
	return {
		path: file.path,
		name: file.basename,
		laneOrder: parseLaneOrder(fm['mtm-lane-order']),
		isInbox,
		icon: isInbox && !fm['mtm-icon'] ? 'inbox' : icon,
		state,
		review: isInbox || !cadence ? null : reviewInfo(fm['mtm-review-every'], fm['mtm-last-reviewed'], today),
		sphere: sphere.id,
		sphereOrphan: sphere.orphan,
		outcome: isInbox ? null : parseOutcome(fm['mtm-outcome']),
	};
}

/** All Matter notes, plus the Inbox even when its note is missing or lost its mtm-kind. */
export function allMatters(app: App, settings: MattersSettings, today: Ymd): MatterInfo[] {
	const files = notesOfKind(app, 'matter');
	const inboxFile = app.vault.getFileByPath(normalizePath(settings.inboxPath));
	if (inboxFile && !files.includes(inboxFile)) files.push(inboxFile);
	const matters = files.map((f) => matterInfo(app, f, settings, today));
	if (!inboxFile) {
		const name = settings.inboxPath.split('/').pop()?.replace(/\.md$/i, '') ?? 'Inbox';
		matters.push({ path: settings.inboxPath, name, laneOrder: null, isInbox: true, icon: 'inbox', state: 'active', review: null, sphere: null, sphereOrphan: null, outcome: null });
	}
	return matters;
}

/** People in the Actions' mtm-people and mtm-waiting-on, most involved first. */
export function peopleOf(app: App, actionPaths: readonly string[]): TFile[] {
	const counts = new Map<TFile, number>();
	for (const path of actionPaths) {
		const file = app.vault.getFileByPath(path);
		const fm = file ? frontmatterOf(app, file) : undefined;
		if (!file || !fm) continue;
		for (const p of peoplePaths(app, fm, path)) {
			const person = app.vault.getFileByPath(p);
			if (person) counts.set(person, (counts.get(person) ?? 0) + 1);
		}
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].basename.localeCompare(b[0].basename)).map(([f]) => f);
}

/** Notes that link to `target`, except Actions (they show as cards), most recently changed first. */
export function backlinksTo(app: App, target: TFile): TFile[] {
	const out: TFile[] = [];
	for (const [source, links] of Object.entries(app.metadataCache.resolvedLinks)) {
		if (source === target.path || !links[target.path]) continue;
		const file = app.vault.getFileByPath(source);
		if (file && frontmatterOf(app, file)?.['mtm-kind'] !== 'action') out.push(file);
	}
	return out.sort((a, b) => b.stat.mtime - a.stat.mtime);
}

/** The note's body: the text after the frontmatter. */
export async function noteBody(app: App, file: TFile): Promise<string> {
	const text = await app.vault.cachedRead(file);
	const end = app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset;
	return end === undefined ? text : text.slice(end).replace(/^\r?\n/, '');
}
