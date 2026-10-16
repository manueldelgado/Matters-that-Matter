// Chips for links to Actions in notes: what a chip shows, and where the links are in a line of Markdown. Pure.

import { isOverdue, toYmd, type MtmDate } from '../model/dates';
import type { Tone } from '../settings';
import type { ActionItem } from './actionItems';

export interface ChipModel {
	path: string;
	title: string;
	typeId: string;
	tone: Tone;
	icon: string;
	/** Closed: faint and struck through, without a date. */
	done: boolean;
	/** The due date while open; null when there is none or the Action is closed. */
	due: MtmDate | null;
}

/** What a chip for this Action shows: its effective type, so an orphaned type shows the default, without a badge. */
export function chipModel(item: ActionItem): ChipModel {
	const done = item.category === 'closed';
	const type = item.effective.type;
	return { path: item.path, title: item.title, typeId: type.id, tone: type.tone, icon: type.icon, done, due: done ? null : item.due };
}

/**
 * A cheap fingerprint: a chip is redrawn only when this changes. For a dated chip the day matters ("Today") and so
 * does whether it is overdue, which a timed Action becomes during the day.
 */
export function chipSignature(model: ChipModel, now: Date): string {
	const due = model.due ? `${model.due.date}T${model.due.time ?? ''}` : '';
	const when = model.due ? `${toYmd(now)}${isOverdue(model.due, now, model.done) ? '!' : ''}` : '';
	return [model.path, model.title, model.typeId, model.tone, model.icon, model.done ? 1 : 0, due, when].join('|');
}

/**
 * What an editor's chips were drawn from: every note its links resolved to, the names its links use (see `noteName`),
 * and whether any link resolved to none.
 */
export interface ChipTargets {
	paths: ReadonlySet<string>;
	names: ReadonlySet<string>;
	unresolved: boolean;
}

/** A note's name as links match it, from a path or a link path: the last segment, without ".md", lower-cased. */
export function noteName(pathOrLink: string): string {
	return (pathOrLink.split('/').pop() ?? '').replace(/\.md$/i, '').toLowerCase();
}

/**
 * Whether a change to the note at `path` (null: settings or the clock) may change an editor's chips: it does when a
 * link there resolved to that note, when a link uses that note's name (it may resolve to it now), or when a link
 * resolved to nothing.
 */
export function chipsAffected(targets: ChipTargets | undefined, path: string | null): boolean {
	return path === null || !targets || targets.unresolved || targets.paths.has(path) || targets.names.has(noteName(path));
}

export interface LinkMatch {
	/** Offsets in the text: the whole link, brackets included. */
	from: number;
	to: number;
	/** What the link points at, as written: a path or name, possibly with #heading or #^block. */
	linktext: string;
	/** What the chip shows: the alias or link text, else the target as Obsidian shows it. */
	display: string;
	/** The author's own words (an alias, or a Markdown link's text): the title goes in the tooltip. */
	hasAlias: boolean;
}

const WIKILINK = /(!?)\[\[([^[\]|]+?)(?:\|([^[\]]*?))?\]\]/g;
const MDLINK = /(!?)\[([^[\]]*)\]\((<[^>]*>|[^\s()]+)\)/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** "Note#Heading" shows as "Note > Heading", as Obsidian does. */
const shown = (target: string) => target.replace(/#\^?/g, ' > ');

function decode(target: string): string {
	try {
		return decodeURIComponent(target);
	} catch {
		return target;
	}
}

/** Internal links in a line of Markdown: wikilinks and Markdown links, without embeds or external URLs. */
export function findLinks(text: string): LinkMatch[] {
	const out: LinkMatch[] = [];
	for (const m of text.matchAll(WIKILINK)) {
		if (m[1] || m.index === undefined) continue;
		const target = (m[2] ?? '').trim();
		if (!target) continue;
		const alias = m[3]?.trim();
		out.push({ from: m.index, to: m.index + m[0].length, linktext: target, display: alias || shown(target), hasAlias: !!alias });
	}
	for (const m of text.matchAll(MDLINK)) {
		if (m[1] || m.index === undefined) continue;
		const raw = (m[3] ?? '').replace(/^<|>$/g, '');
		if (!raw || SCHEME.test(raw)) continue;
		// Inside a wikilink's brackets: not a Markdown link.
		if (out.some((w) => m.index !== undefined && m.index >= w.from && m.index < w.to)) continue;
		const target = decode(raw);
		const label = (m[2] ?? '').trim();
		out.push({ from: m.index, to: m.index + m[0].length, linktext: target, display: label || shown(target), hasAlias: !!label });
	}
	return out.sort((a, b) => a.from - b.from);
}
