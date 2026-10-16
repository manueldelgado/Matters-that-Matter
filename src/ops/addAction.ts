// Add an Action: from fields, quick add text, or both (fields win). Values that match nothing fall back as quick add
// does (the default type, the Inbox, the backlog status), with a warning each; nothing else is created.

import type { Priority } from '../model/actions';
import { parseMtmDate, startsAfterDue } from '../model/dates';
import { sanitiseTitle } from '../model/titles';
import type { MatterInfo } from '../services/boardModel';
import { matchDefined, matchNote } from '../services/match';
import { matterLink, newActionFrontmatter } from '../services/notesModel';
import { STRINGS } from '../strings';
import { publicField } from './fieldNames';
import { done, fail, fallbacks, isBlank, notAPerson, readDate, readDetails, readLink, readList, readPriority, readText, readiness, type Read } from './fields';
import { PlanBuilder } from './plan';
import { parseText, tokenWarnings } from './quickAddText';
import { summaryAfter } from './actionWrite';
import type { ActionWrite, AddActionInput, BodyEdit, OpError, OpResult, Snapshot, Warning } from './types';
import { freeName, joinPath, vaultView } from './vaultView';

const T = STRINGS.ops;

function ambiguousError(field: string, value: string, message: string, candidates: string[]): OpError {
	return { code: 'ambiguous', field, value, message, candidates };
}

/** The fields as given, without the empty ones: an empty optional value (or null) says nothing, so it is left out. */
function withoutEmpty(given: AddActionInput): AddActionInput {
	const input: Record<string, unknown> = { ...given };
	for (const [key, value] of Object.entries(input)) if (value === undefined || value === null || isBlank(value)) delete input[key];
	for (const key of ['people', 'checklist'] as const) {
		const list = input[key];
		if (Array.isArray(list)) input[key] = list.filter((v) => !isBlank(v));
	}
	return input;
}

export function addAction(given: AddActionInput, s: Snapshot): OpResult<ActionWrite> {
	const input = withoutEmpty(given);
	const ready = readiness(s, true);
	if (ready.error) return { ok: false, error: ready.error };
	const warnings: Warning[] = [...ready.warnings];
	const { settings } = s;
	const view = vaultView(s);
	const { backlog, fallbackType } = fallbacks(s);
	const inbox = view.matters.find((m) => m.isInbox) as MatterInfo;

	let text = null;
	if (input.text !== undefined) {
		const t = readText('text', input.text);
		if (!t.ok) return t;
		text = parseText(t.value, s);
	}

	// The title, and where the note goes.
	if (input.title !== undefined && typeof input.title !== 'string') return fail({ code: 'invalid', field: 'title', message: T.badText('title') });
	// An empty title field leaves the title to the text.
	const rawTitle = input.title?.trim() ? input.title : (text?.title ?? '');
	// A title of nothing but characters a file name can't have is no title either.
	const base = sanitiseTitle(rawTitle);
	if (!base) return fail({ code: 'invalid', field: 'title', ...(rawTitle.trim() ? { value: rawTitle } : {}), message: T.noTitle });
	const folder = settings.folders.actions;
	// A name any note has is taken, so links to that note never reach the new one.
	const title = freeName(s, folder, base);
	const path = joinPath(folder, `${title}.md`);

	// Status, type and Matter: fields first, then the text, then the fallbacks.
	let status = backlog;
	if (input.status !== undefined) {
		const m = matchDefined(input.status, settings.statuses);
		if (m.kind === 'ambiguous') return fail(ambiguousError('status', input.status, T.severalStatuses(input.status), m.items.map((i) => i.label)));
		if (m.kind === 'match') status = m.item;
		else warnings.push({ code: 'unmatched-status', field: 'status', value: input.status, message: T.noStatus(input.status, backlog.label) });
	}

	// A field that matches nothing falls back to what the text says, else to the default.
	const textType = settings.types.find((t) => t.id === text?.typeId);
	let type = textType ?? fallbackType;
	if (input.type !== undefined) {
		const m = matchDefined(input.type, settings.types);
		if (m.kind === 'ambiguous') return fail(ambiguousError('type', input.type, T.severalTypes(input.type), m.items.map((i) => i.label)));
		if (m.kind === 'match') type = m.item;
		else warnings.push({ code: 'unmatched-type', field: 'type', value: input.type, message: T.noType(input.type, type.label, !!textType) });
	}

	const textMatter = view.matters.find((m) => m.path === text?.matterPath);
	let matterPath = textMatter?.path ?? inbox.path;
	if (input.matter !== undefined) {
		const m = matchNote(
			input.matter,
			view.matters.map((x) => ({ path: x.path, name: x.name })),
			(t) => s.resolve(t, path),
		);
		if (m.kind === 'ambiguous') return fail(ambiguousError('matter', input.matter, T.severalMatters(input.matter), m.items.map((i) => i.path)));
		if (m.kind === 'match') matterPath = m.item.path;
		else warnings.push({ code: 'unmatched-matter', field: 'matter', value: input.matter, message: T.noMatter(input.matter, true, textMatter?.name) });
	}

	if (text) warnings.push(...tokenWarnings(text, { type: input.type !== undefined, matter: input.matter !== undefined, people: input.people !== undefined }, fallbackType.label));

	// Other fields.
	let priority: Priority | null = text?.priority ?? null;
	if (input.priority !== undefined) {
		const p = readPriority(input.priority);
		if (!p.ok) return p;
		priority = p.value;
	}
	let start = text?.start ?? null;
	if (input.start !== undefined) {
		const d = readDate('start', input.start, s);
		if (!d.ok) return d;
		start = d.value;
	}
	let due = text?.due ?? null;
	if (input.due !== undefined) {
		const d = readDate('due', input.due, s);
		if (!d.ok) return d;
		due = d.value;
	}

	// People: never created; one that matches nothing is left out with a warning.
	const person = (key: string, value: string): Read<string | null> => {
		const field = publicField(key);
		const m = matchNote(value, view.people, (t) => s.resolve(t, path));
		if (m.kind === 'ambiguous') return fail(ambiguousError(field, value, T.severalPeople(value), m.items.map((i) => i.path)));
		if (m.kind === 'match') return done(m.item.path);
		warnings.push({ code: 'unmatched-person', field, value, message: T.noPerson(value, true, notAPerson(value, s, path) ?? undefined) });
		return done(null);
	};
	let people = text?.people ?? [];
	if (input.people !== undefined) {
		const list = readList('people', input.people);
		if (!list.ok) return list;
		people = [];
		for (const value of list.value) {
			const p = person('people', value);
			if (!p.ok) return p;
			if (p.value) people.push(p.value);
		}
	}
	let waitingOn: string | null = null;
	if (input.waitingOn !== undefined && input.waitingOn !== null) {
		const w = readText(publicField('waitingOn'), input.waitingOn);
		if (!w.ok) return w;
	}
	if (typeof input.waitingOn === 'string' && input.waitingOn.trim() !== '') {
		const p = person('waitingOn', input.waitingOn);
		if (!p.ok) return p;
		waitingOn = p.value;
	}

	// The body: details, then the checklist, then the link.
	const bodyEdits: BodyEdit[] = [];
	if (input.details !== undefined) {
		const d = readDetails(input.details);
		if (!d.ok) return d;
		if (d.value.trim()) bodyEdits.push({ kind: 'details', text: d.value });
	}
	const checklist = input.checklist === undefined ? done<string[]>([]) : readList('checklist', input.checklist);
	if (!checklist.ok) return checklist;
	// The same item twice is written once.
	const items = [...new Set(checklist.value.map((i) => i.replace(/\s+/g, ' ').trim()).filter(Boolean))];
	if (items.length) bodyEdits.push({ kind: 'checklist', items });
	if (input.link !== undefined) {
		const l = readLink(input.link, path, s);
		if (!l.ok) return l;
		bodyEdits.push({ kind: 'link', line: l.value });
	}

	const linkTo = (target: string) => `[[${s.linkText(target, path)}]]`;
	const unique = [...new Set(waitingOn && !people.includes(waitingOn) ? [...people, waitingOn] : people)];
	const fm = newActionFrontmatter(
		{
			statusId: status.id,
			typeId: type.id,
			matterLink: matterLink(matterPath, s.exists(matterPath) ? s.linkText(matterPath, path) : null),
			priority,
			start,
			due,
			waitingOn: waitingOn && linkTo(waitingOn),
			people: unique.map(linkTo),
		},
		settings.statuses,
		view.today,
	);
	if (startsAfterDue(parseMtmDate(start), parseMtmDate(due))) warnings.push({ code: 'start-after-due', message: T.startAfterDue });
	// The Action links to the Inbox all the same; the plugin creates the note again.
	if (matterPath === inbox.path && !s.exists(inbox.path)) warnings.push({ code: 'missing-inbox', value: inbox.path, message: T.missingInbox(inbox.path) });

	const builder = new PlanBuilder();
	builder.create(path, fm, bodyEdits);
	return { ok: true, value: { action: summaryAfter(path, title, fm, s), changed: true }, plan: builder.plan, changes: builder.changes, warnings };
}
