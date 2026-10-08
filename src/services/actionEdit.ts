// Inspector edits to an Action's frontmatter, besides status, Matter and type. Pure.

import type { Priority } from '../model/actions';
import { formatMtmDate, type MtmDate } from '../model/dates';

/** A link to write, with the key that identifies its target (the resolved path). */
export interface LinkValue {
	link: string;
	key: string;
}

export interface FieldEdit {
	priority?: Priority | null;
	start?: MtmDate | null;
	due?: MtmDate | null;
	/** Setting someone also adds them to mtm-people; null clears mtm-waiting-on only. */
	waitingOn?: LinkValue | null;
	addPerson?: LinkValue;
	/** Key of the person to remove from mtm-people. */
	removePerson?: string;
}

/** The key a raw link value points to (the resolved path, or the link text when it does not resolve). */
export type KeyOf = (raw: unknown) => string | null;

/** mtm-people as a list, whether it holds one value or several. */
export function peopleList(raw: unknown): unknown[] {
	if (raw === undefined || raw === null || raw === '') return [];
	return Array.isArray(raw) ? [...(raw as unknown[])] : [raw];
}

function setOrDelete(fm: Record<string, unknown>, key: string, value: unknown): void {
	if (value === null || value === undefined) delete fm[key];
	else fm[key] = value;
}

export function applyFieldEdit(fm: Record<string, unknown>, edit: FieldEdit, keyOf: KeyOf): void {
	if (edit.priority !== undefined) setOrDelete(fm, 'mtm-priority', edit.priority);
	if (edit.start !== undefined) setOrDelete(fm, 'mtm-start', edit.start && formatMtmDate(edit.start));
	if (edit.due !== undefined) setOrDelete(fm, 'mtm-due', edit.due && formatMtmDate(edit.due));

	let people = peopleList(fm['mtm-people']);
	const add = (person: LinkValue) => {
		if (!people.some((p) => keyOf(p) === person.key)) people.push(person.link);
	};
	if (edit.waitingOn !== undefined) {
		setOrDelete(fm, 'mtm-waiting-on', edit.waitingOn?.link);
		if (edit.waitingOn) add(edit.waitingOn);
	}
	if (edit.addPerson) add(edit.addPerson);
	if (edit.removePerson !== undefined) people = people.filter((p) => keyOf(p) !== edit.removePerson);

	const touchesPeople = edit.waitingOn || edit.addPerson || edit.removePerson !== undefined;
	if (touchesPeople) setOrDelete(fm, 'mtm-people', people.length ? people : null);
}
