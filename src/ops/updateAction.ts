// Update an Action: any field, strictly. A value that matches nothing is an error and nothing is planned; a new title
// renames the note (link updates are the applier's part).

import { parseMtmDate, startsAfterDue } from '../model/dates';
import { sanitiseTitle, uniqueTitle } from '../model/titles';
import { applyFieldEdit, type FieldEdit } from '../services/actionEdit';
import { personKey } from '../services/notesModel';
import { STRINGS } from '../strings';
import { EXPLICIT_KEYS, place, summaryAfter } from './actionWrite';
import { fail, findMatter, findPerson, findStatus, findType, readDate, readLink, readPriority, readList, readText, readiness } from './fields';
import { findAction } from './findAction';
import { applyBodyEdit, PlanBuilder } from './plan';
import type { ActionFields, ActionWrite, BodyEdit, OpResult, Snapshot, UpdateActionInput, Warning } from './types';
import { publicField } from './fieldNames';
import { folderOfPath, joinPath, vaultView } from './vaultView';

const T = STRINGS.ops;

const FRONTMATTER_FIELDS: readonly (keyof ActionFields)[] = ['matter', 'status', 'type', 'priority', 'start', 'due', 'waitingOn', 'people'];
const ALL_FIELDS: readonly (keyof ActionFields)[] = [...FRONTMATTER_FIELDS, 'title', 'details', 'checklist', 'link'];

export function updateAction(input: UpdateActionInput, s: Snapshot): OpResult<ActionWrite> {
	const ready = readiness(s, true);
	if (ready.error) return { ok: false, error: ready.error };
	const warnings: Warning[] = [...ready.warnings];

	const found = findAction(input.action, s);
	if (!found.ok) return found;
	const { note, item } = found.value;
	const path = note.path;
	const current = item.effective;
	if (!ALL_FIELDS.some((f) => input[f] !== undefined)) return fail({ code: 'invalid', message: T.nothingToChange });

	// Every value is read before anything is planned.
	let status = current.status;
	if (input.status !== undefined) {
		const r = findStatus(input.status, s);
		if (!r.ok) return r;
		status = r.value;
	}
	let typeId = current.type.id;
	if (input.type !== undefined) {
		const r = findType(input.type, s);
		if (!r.ok) return r;
		typeId = r.value.id;
	}
	let matterPath = current.matterPath;
	if (input.matter !== undefined) {
		const r = findMatter(input.matter, s, path);
		if (!r.ok) return r;
		matterPath = r.value.path;
	}

	const edit: FieldEdit = {};
	if (input.priority !== undefined) {
		const r = readPriority(input.priority);
		if (!r.ok) return r;
		edit.priority = r.value;
	}
	for (const field of ['start', 'due'] as const) {
		const value = input[field];
		if (value === undefined) continue;
		const r = readDate(field, value, s);
		if (!r.ok) return r;
		edit[field] = r.value === null ? null : parseMtmDate(r.value);
	}
	const linkTo = (target: string) => `[[${s.linkText(target, path)}]]`;
	if (input.waitingOn !== undefined) {
		if (input.waitingOn !== null && typeof input.waitingOn !== 'string') return fail({ code: 'invalid', field: publicField('waitingOn'), message: T.badText(publicField('waitingOn')) });
		if (input.waitingOn === null || input.waitingOn.trim() === '') edit.waitingOn = null;
		else {
			const r = findPerson('waitingOn', input.waitingOn, s, path);
			if (!r.ok) return r;
			edit.waitingOn = { link: linkTo(r.value.path), key: r.value.path };
		}
	}
	let people: string[] | undefined;
	if (input.people !== undefined) {
		const list = readList('people', input.people);
		if (!list.ok) return list;
		people = [];
		for (const value of list.value) {
			const r = findPerson('people', value, s, path);
			if (!r.ok) return r;
			if (!people.includes(r.value.path)) people.push(r.value.path);
		}
	}

	const bodyEdits: BodyEdit[] = [];
	if (input.details !== undefined) {
		const r = readText('details', input.details);
		if (!r.ok) return r;
		bodyEdits.push({ kind: 'details', text: r.value });
	}
	if (input.checklist !== undefined) {
		const list = readList('checklist', input.checklist);
		if (!list.ok) return list;
		const items = list.value.filter((i) => i.trim()).map((i) => i.trim());
		if (items.length) bodyEdits.push({ kind: 'checklist', items });
	}
	if (input.link !== undefined) {
		const r = readLink(input.link, path, s);
		if (!r.ok) return r;
		bodyEdits.push({ kind: 'link', line: r.value });
	}

	let newPath = path;
	let title = note.basename;
	if (input.title !== undefined) {
		const r = readText('title', input.title);
		if (!r.ok) return r;
		const base = sanitiseTitle(r.value);
		if (!base) return fail({ code: 'invalid', field: 'title', value: r.value, message: T.noTitle });
		if (base !== note.basename) {
			const folder = folderOfPath(path);
			// The note itself doesn't block its own name (a change of case only renames it).
			title = uniqueTitle(base, (t) => {
				const candidate = joinPath(folder, `${t}.md`);
				return candidate.toLowerCase() !== path.toLowerCase() && s.exists(candidate);
			});
			newPath = joinPath(folder, `${title}.md`);
		}
	}

	// The plan.
	const builder = new PlanBuilder();
	const before = note.frontmatter ?? {};
	const after: Record<string, unknown> = { ...before };
	if (FRONTMATTER_FIELDS.some((f) => input[f] !== undefined)) {
		place(after, { status, typeId, matterPath }, { statusId: current.status.id, category: current.category, matterPath: current.matterPath }, path, s);
		if (people) {
			if (people.length) after['mtm-people'] = people.map(linkTo);
			else delete after['mtm-people'];
		}
		const keyOf = (raw: unknown) => personKey(raw, (t) => {
			const target = s.resolve(t, path);
			return target ? { path: target } : null;
		});
		applyFieldEdit(after, edit, keyOf, vaultView(s).today);
		builder.edit(path, before, after, EXPLICIT_KEYS);
	}
	// Body edits that leave the note as it is (the same details again) are not planned.
	let content = bodyEdits.length ? (s.content(path) ?? '') : '';
	for (const e of bodyEdits) {
		const next = applyBodyEdit(content, e);
		if (next === content) continue;
		builder.body(path, content, e);
		content = next;
	}
	if (newPath !== path) builder.rename(path, newPath);

	if (startsAfterDue(parseMtmDate(after['mtm-start']), parseMtmDate(after['mtm-due']))) warnings.push({ code: 'start-after-due', message: T.startAfterDue });
	const changed = builder.changes.length > 0;
	return { ok: true, value: { action: summaryAfter(newPath, title, after, s), changed }, plan: builder.plan, changes: builder.changes, warnings };
}

