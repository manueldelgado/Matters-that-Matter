// Human output, in the plugin's words: relative dates, type colours as dots beside the type's name, quiet paths.
// Colour is an extra (only on a terminal, never with NO_COLOR): every line says the same without it.

import { waitAge } from '../../src/model/actions';
import { dateLabel, parseMtmDate, shortDate, weekday, type Ymd } from '../../src/model/dates';
import { parseCadence } from '../../src/model/matters';
import type {
	ActionDetail,
	ActionSummary,
	Change,
	MatterSummary,
	OpError,
	ParsedQuickAdd,
	TodayValue,
	Warning,
	WorkflowValue,
} from '../../src/ops/types';
import { STRINGS } from '../../src/strings';
import type { FileOutcome } from './filesLayer';
import { CLI } from './strings';

// ——— Colour ———

type Paint = (text: string) => string;

export interface Style {
	on: boolean;
	b: Paint;
	d: Paint;
	g: Paint;
	y: Paint;
	r: Paint;
	tone: (tone: string) => Paint;
}

const sgr = (on: boolean, open: string, close: string): Paint => (on ? (t) => (t ? `\u001b[${open}m${t}\u001b[${close}m` : t) : (t) => t);

/** The 16 basic colours for the palette's tones. */
const TONE_SGR: Record<string, string> = { mint: '32', sky: '36', butter: '33', lavender: '35', peach: '31', bubblegum: '95', ink: '37' };

export function style(on: boolean): Style {
	return {
		on,
		b: sgr(on, '1', '22'),
		d: sgr(on, '2', '22'),
		g: sgr(on, '32', '39'),
		y: sgr(on, '33', '39'),
		r: sgr(on, '31', '39'),
		tone: (tone) => sgr(on, TONE_SGR[tone] ?? '37', '39'),
	};
}

/** Whether a stream gets colour: a terminal, and NO_COLOR unset or empty. */
export function colourFor(isTTY: boolean | undefined, env: Readonly<Record<string, string | undefined>>): boolean {
	return !!isTTY && !env.NO_COLOR;
}

/** Text with `<b>…</b>` and `<d>…</d>` marks, painted (or the marks dropped). */
export function markup(text: string, st: Style): string {
	return text.replace(/<b>(.*?)<\/b>/g, (_, t: string) => st.b(t)).replace(/<d>(.*?)<\/d>/g, (_, t: string) => st.d(t));
}

// ——— Layout ———

/** A cell: plain text, or text with its paint (padding stays outside the paint). */
type Cell = string | [text: string, paint: Paint];

/** Rows as aligned columns: each column as wide as its widest cell plus its gap; trailing spaces dropped. */
function columns(rows: readonly Cell[][], gaps: readonly number[], indent = '  '): string[] {
	const text = (c: Cell | undefined) => (c === undefined ? '' : typeof c === 'string' ? c : c[0]);
	const widths: number[] = [];
	for (const row of rows) row.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, [...text(c)].length)));
	return rows.map((row) => {
		let line = indent;
		row.forEach((c, i) => {
			// A column empty in every row takes no room.
			if (!widths[i]) return;
			const t = text(c);
			const painted = typeof c === 'string' ? c : c[1](t);
			const last = i === row.length - 1 || row.slice(i + 1).every((x) => text(x) === '');
			line += last ? painted : painted + ' '.repeat((widths[i] ?? 0) - [...t].length + (gaps[i] ?? 2));
		});
		return line.replace(/\s+$/, '');
	});
}

// ——— Words ———

/** "Today", "Tomorrow" and "Yesterday" in lower case mid-sentence ("due today 10:00"); weekdays and dates as they are. */
const midSentence = (label: string) => label.replace(/^(Today|Tomorrow|Yesterday)\b/, (w) => w.toLowerCase());

/** A stored date as the plugin labels it: "Today 10:00", "Friday", "Fri 16 Oct". */
export function dateWords(stored: string | null, today: Ymd): string {
	const d = parseMtmDate(stored);
	return d ? dateLabel(d, today) : '';
}

export const priorityWord = (p: 1 | 2 | 3 | null): string => (p ? STRINGS.card.priority[p].toLowerCase() : '');

/** "Friday 9 October". */
export function longDate(ymd: Ymd): string {
	const [, m = 1, d = 1] = ymd.split('-').map(Number);
	return `${STRINGS.dates.weekdays[weekday(ymd)] ?? ''} ${d} ${STRINGS.dates.months[m - 1] ?? ''}`;
}

const quote = (t: string) => `“${t}”`;

/** "Kitchen renovation · Later · Call · due Fri 16 Oct 10:00 · high priority · waiting on Marco Rossi". */
function summaryParts(
	a: { matter: string; status: string; type: string; start: string | null; due: string | null; priority: 1 | 2 | 3 | null; waitingOn?: string | null },
	today: Ymd,
): string {
	const parts = [a.matter, a.status, a.type];
	if (a.start) parts.push(`${CLI.starts} ${midSentence(dateWords(a.start, today))}`);
	if (a.due) parts.push(`${CLI.due} ${midSentence(dateWords(a.due, today))}`);
	if (a.priority) parts.push(STRINGS.card.priorityTitle(priorityWord(a.priority)));
	if (a.waitingOn) parts.push(STRINGS.card.waitingOn(a.waitingOn).replace(/^W/, 'w'));
	return parts.join(' · ');
}

export function actionLine(a: ActionSummary, today: Ymd): string {
	return summaryParts(
		{ matter: a.matter.name, status: a.status.label, type: a.type.label, start: a.start, due: a.due, priority: a.priority, waitingOn: a.waitingOn?.name },
		today,
	);
}

/** The date cell of a row: red when late, yellow when due today; with `sayLate`, late rows also say so in words. */
function dateCell(a: ActionSummary, today: Ymd, st: Style, sayLate = false): Cell {
	const words = dateWords(a.due, today);
	if (!words) return '';
	const text = sayLate && a.overdue ? `${words}, ${STRINGS.embed.late.toLowerCase()}` : words;
	return [text, a.overdue ? st.r : a.today ? st.y : (t) => t];
}

const typeCell = (a: ActionSummary, tones: ReadonlyMap<string, string>, st: Style): Cell => [`● ${a.type.label}`, (t) => st.tone(tones.get(a.type.id) ?? 'ink')('●') + t.slice(1)];

/** The orphan badges, as the inspector words them. */
function orphanText(a: ActionSummary): string {
	if (!a.orphans.length) return '';
	const parts = a.orphans.map((o) =>
		o.field === 'status'
			? STRINGS.inspector.orphanStatus(o.raw, a.status.label)
			: o.field === 'type'
				? STRINGS.inspector.orphanType(o.raw, a.type.label)
				: STRINGS.inspector.orphanMatter(o.raw),
	);
	return `${STRINGS.inspector.orphanTitle} ${parts.join(', ')}`;
}

// ——— Reads ———

export function formatToday(v: TodayValue, vaultShown: string, tones: ReadonlyMap<string, string>, st: Style): string[] {
	const out = [`${st.b(STRINGS.today.question)}  ${st.d(`${longDate(v.date)} · ${vaultShown}`)}`, ''];
	const row = (a: ActionSummary): Cell[] => [typeCell(a, tones, st), a.title, [a.matter.name, st.d], dateCell(a, v.date, st), [priorityWord(a.priority), st.d]];
	if (v.due.length) {
		out.push(st.y(CLI.dueTodayOrLate), ...columns(v.due.map(row), [2, 3, 3, 2]));
	} else if (v.next.length) {
		out.push(st.y(STRINGS.today.nextUp), ...columns(v.next.map(row), [2, 3, 3, 2]));
	} else {
		out.push(STRINGS.today.emptyTitle, st.d(STRINGS.today.emptyText));
	}
	const footer = [v.inbox ? CLI.toSort(v.inbox) : '', v.reviews.length ? CLI.reviewsDue(v.reviews.length) : '', v.longWaits ? CLI.longWaits(v.longWaits) : ''].filter(Boolean);
	if (footer.length) out.push('', st.d(footer.join(' · ')));
	return out;
}

export function formatList(list: readonly ActionSummary[], today: Ymd, tones: ReadonlyMap<string, string>, st: Style): string[] {
	if (!list.length) return [CLI.noActions];
	const rows: Cell[][] = list.map((a) => {
		const waiting = a.waitingOn ? CLI.waitingOn(a.waitingOn.name, a.waitingSince ? waitAge(a.waitingSince, today).long : '').replace(/, $/, '') : '';
		const orphans = orphanText(a);
		const note: Cell = orphans ? [[waiting, orphans].filter(Boolean).join(' · '), st.y] : [waiting, st.d];
		return [typeCell(a, tones, st), a.title, a.status.label, dateCell(a, today, st, true), [priorityWord(a.priority), st.d], note];
	});
	const lines = columns(rows, [2, 3, 2, 2, 2]);
	const out: string[] = [];
	let matter: string | null = null;
	list.forEach((a, i) => {
		if (a.matter.path !== matter) {
			if (matter !== null) out.push('');
			out.push(st.b(a.matter.name));
			matter = a.matter.path;
		}
		out.push(lines[i] ?? '');
	});
	out.push('', st.d(CLI.actions(list.length)));
	return out;
}

export function formatShow(a: ActionDetail, today: Ymd, st: Style): string[] {
	const out = [st.b(a.title), `  ${actionLine({ ...a, waitingOn: null }, today)}`];
	if (a.waitingOn) {
		out.push(
			`  ${a.waitingSince ? STRINGS.card.waitingSince(a.waitingOn.name, shortDate(a.waitingSince, today), waitAge(a.waitingSince, today).long) : STRINGS.card.waitingOn(a.waitingOn.name)}`,
		);
	}
	if (a.completed) {
		const days = Math.round((Date.parse(today) - Date.parse(a.completed)) / 86_400_000);
		out.push(`  ${days === 0 ? STRINGS.noteBanner.doneToday : days === 1 ? STRINGS.noteBanner.doneYesterday : STRINGS.noteBanner.doneOn(shortDate(a.completed, today))}`);
	}
	if (a.people.length) out.push(`  ${CLI.people}: ${a.people.map((p) => p.name).join(', ')}`);
	if (a.startsAfterDue) out.push(`  ${st.y(STRINGS.inspector.startAfterDue)} ${STRINGS.inspector.startAfterDueText}`);
	const orphans = orphanText(a);
	if (orphans) out.push(`  ${st.y(orphans)}`);
	out.push(`  ${st.d(a.path)}`);
	if (a.details.trim()) out.push('', ...a.details.trim().split('\n').map((l) => (l ? `  ${l}` : '')));
	if (a.checklist.length) {
		out.push('', `  ${CLI.checklist(a.checklist.filter((c) => c.checked).length, a.checklist.length)}`);
		for (const item of a.checklist) out.push(`    [${item.checked ? 'x' : ' '}] ${item.text}`);
	}
	if (a.linkedNotes.length) out.push('', `  ${STRINGS.card.linkedNotes}: ${a.linkedNotes.map((n) => n.name).join(', ')}`);
	return out;
}

/** A label from the plugin mid-line: its first letter in lower case ("dormant", "no next Action"). */
const midLine = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);

export function formatMatters(list: readonly MatterSummary[], st: Style): string[] {
	const rows: Cell[][] = list.map((m) => {
		const parts: string[] = [];
		const add = (label: string) => parts.push(parts.length ? midLine(label) : label);
		// The Sphere is the user's own label, as they wrote it.
		if (m.sphere) parts.push(m.sphere.label);
		if (m.state === 'dormant') add(STRINGS.board.dormant);
		if (m.state === 'closed') add(STRINGS.board.closed);
		add(STRINGS.board.open(m.counts.open));
		if (m.counts.today) add(STRINGS.noteBanner.late(m.counts.today));
		if (m.counts.waiting) add(STRINGS.board.waiting(m.counts.waiting));
		if (m.review) {
			if (m.review.due) add(STRINGS.board.reviewDue);
			else if (m.review.daysSince !== null) add(STRINGS.board.reviewedAgo(m.review.daysSince));
		}
		if (m.noNextAction) add(STRINGS.nextAction.hint);
		return [[m.name, st.b], parts.join(' · ')];
	});
	return [...columns(rows, [3], ''), '', st.d(CLI.matters(list.length))];
}

export function formatWorkflow(w: WorkflowValue, st: Style): string[] {
	const out = [st.b(CLI.statuses)];
	out.push(
		...columns(
			w.statuses.map((s) => [s.label, [s.id, st.d], STRINGS.categories[s.category], [[s.backlog ? CLI.backlogMark : '', s.done ? CLI.doneMark : ''].filter(Boolean).join(', '), st.d]]),
			[2, 2, 2],
		),
	);
	out.push('', st.b(CLI.types));
	out.push(...columns(w.types.map((t) => [[`● ${t.label}`, (x) => st.tone(t.tone)('●') + x.slice(1)], [t.id, st.d], [t.default ? CLI.defaultMark : '', st.d]]), [2, 2]));
	out.push('', st.b(CLI.spheres));
	if (w.spheres.length) out.push(...columns(w.spheres.map((s) => [s.label, [s.id, st.d]]), [2]));
	else out.push(`  ${st.d(CLI.noSpheres)}`);
	return out;
}

export function formatParse(p: ParsedQuickAdd, warnings: readonly Warning[], today: Ymd, st: Style): string[] {
	const out = [
		st.b(quote(p.title)),
		`  ${summaryParts({ matter: p.matter.name, status: p.status.label, type: p.type.label, start: p.start, due: p.due, priority: p.priority }, today)}`,
	];
	if (p.people.length) out.push(`  ${CLI.people}: ${p.people.map((x) => x.name).join(', ')}`);
	out.push(
		p.chips.length
			? `  ${CLI.read}: ${p.chips.map((c) => (c.valid ? c.text : `${c.text} (${CLI.noMatch})`)).join(', ')}`
			: `  ${st.d(CLI.nothingRead)}`,
	);
	for (const w of warnings) out.push(`  ${st.y(w.message)}`);
	return out;
}

// ——— Writes ———

/** A property's value as one line. */
function valueText(v: unknown): string {
	if (v === null || v === undefined) return CLI.none;
	if (Array.isArray(v)) return v.map(valueText).join(', ');
	if (typeof v === 'string') return v;
	return JSON.stringify(v);
}

const clip = (t: string) => {
	const one = t.replace(/\s+/g, ' ').trim();
	return one.length > 48 ? `${one.slice(0, 47)}…` : one;
};

/** What changed, property by property: `mtm-status     next → done`. */
export function changeLines(changes: readonly Change[], st: Style): string[] {
	const rows: [string, string][] = [];
	for (const c of changes) {
		if (c.kind === 'property') rows.push([c.key, `${valueText(c.from)} → ${valueText(c.to)}`]);
		else if (c.kind === 'details') rows.push([CLI.detailsKey, `${c.from ? quote(clip(c.from)) : CLI.none} → ${c.to ? quote(clip(c.to)) : CLI.none}`]);
		else if (c.kind === 'checklist') c.added.forEach((item, i) => rows.push([i === 0 ? CLI.checklistKey : '', `+ ${item}`]));
		else if (c.kind === 'link') rows.push([CLI.linkKey, `+ ${c.line}`]);
	}
	const width = Math.max(0, ...rows.map(([k]) => k.length)) + 2;
	return rows.map(([k, v]) => `  ${k ? st.d(k) : ''}${' '.repeat(width - k.length)}${v}`);
}

/** The links a rename updated (or would), file by file. */
function linkLines(outcome: FileOutcome | null, dryRun: boolean, st: Style): string[] {
	if (!outcome) return [];
	const out: string[] = [];
	const count = outcome.links.reduce((n, l) => n + l.lines.length, 0);
	if (count) {
		out.push(`  ${(dryRun ? CLI.wouldUpdateLinks : CLI.updatedLinks)(count, outcome.links.length)}`);
		out.push(...columns(outcome.links.map((l) => [l.path, [CLI.lines(l.lines), st.d]]), [6], '    '));
	}
	if (outcome.danglingLinks) out.push(`  ${st.y(CLI.danglingLinks(outcome.danglingLinks))}`);
	return out;
}

const warningLines = (warnings: readonly Warning[], st: Style) => warnings.filter((w) => w.code !== 'newer-settings').map((w) => `  ${st.y(w.message)}`);

export function formatAdded(a: ActionSummary, warnings: readonly Warning[], today: Ymd, dryRun: boolean, st: Style): string[] {
	const head = dryRun ? st.b(CLI.wouldAdd) : st.g(CLI.added);
	const out = [`${head} ${quote(a.title)}`, `  ${actionLine(a, today)}`, ...warningLines(warnings, st), `  ${st.d(a.path)}`];
	if (dryRun) out.push(CLI.dryRun);
	return out;
}

export function formatMatterAdded(m: MatterSummary, warnings: readonly Warning[], dryRun: boolean, st: Style): string[] {
	const head = dryRun ? st.b(CLI.wouldAddMatter) : st.g(CLI.addedMatter);
	const parts: string[] = [];
	if (m.sphere) parts.push(m.sphere.label);
	const state = m.state === 'active' ? STRINGS.categories.active : m.state === 'dormant' ? STRINGS.board.dormant : STRINGS.board.closed;
	parts.push(parts.length ? midLine(state) : state);
	const cadence = m.review ? parseCadence(m.review.every) : null;
	if (cadence) {
		const unit = STRINGS.cadence.units(cadence.n).find(([u]) => u === cadence.unit)?.[1] ?? '';
		parts.push(CLI.reviewEvery(cadence.n === 1 ? unit : `${cadence.n} ${unit}`));
	}
	const out = [`${head} ${quote(m.name)}`, `  ${parts.join(' · ')}`];
	if (m.outcome) out.push(`  ${m.outcome}`);
	out.push(...warningLines(warnings, st), `  ${st.d(m.path)}`);
	if (dryRun) out.push(CLI.dryRun);
	return out;
}

/** An existing Action changed: properties and body, then a rename with the links it updated. */
export function formatChanged(
	verb: string,
	before: { title: string; path: string },
	after: ActionSummary,
	changes: readonly Change[],
	warnings: readonly Warning[],
	outcome: FileOutcome | null,
	dryRun: boolean,
	st: Style,
): string[] {
	if (!changes.length) return [CLI.already(before.title)];
	const rename = changes.find((c): c is Extract<Change, { kind: 'rename' }> => c.kind === 'rename');
	const props = changes.filter((c) => c.kind !== 'rename' && c.kind !== 'create');
	const out: string[] = [];
	if (props.length) {
		out.push(dryRun ? `${st.b(CLI.wouldChange)} ${before.path}` : `${st.g(verb)} ${quote(before.title)}`);
		out.push(...changeLines(props, st));
		if (!dryRun && !rename) out.push(`  ${st.d(after.path)}`);
	}
	if (rename) {
		out.push(`${dryRun ? st.b(CLI.wouldRenameTo) : st.g(CLI.renamedTo)} ${quote(after.title)}`);
		out.push(`  ${st.d(rename.to)}`, ...linkLines(outcome, dryRun, st));
	}
	out.push(...warningLines(warnings, st));
	if (dryRun) out.push(CLI.dryRun);
	return out;
}

// ——— Errors ———

/** An operation's error: its first sentence stands out; candidates listed; for writes, a reminder that nothing changed. */
export function formatError(e: OpError, write: boolean, st: Style): string[] {
	if (e.code === 'ambiguous' && e.candidates?.length) {
		return [st.r(e.message.replace(/\.$/, ':')), ...e.candidates.map((c) => `  ${c}`), CLI.useHint(e.field)];
	}
	const cut = e.message.search(/\.\s/);
	const [first, rest] = cut < 0 ? [e.message, ''] : [e.message.slice(0, cut + 1), e.message.slice(cut + 1)];
	const out = [`${st.r(first)}${rest}`];
	if (write && e.code !== 'not-ready') out.push(CLI.nothingChanged);
	return out;
}
