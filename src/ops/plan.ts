// Building plans, and the pure pieces any applier uses: body edits and frontmatter edits.

import { appendLine, getDetails, insertTask, setDetails } from '../model/body';
import type { BodyEdit, Change, Plan } from './types';

export function emptyPlan(): Plan {
	return { creates: [], edits: [], bodies: [], renames: [] };
}

/** A note's content after a body edit; the frontmatter and every other line stay as they are. */
export function applyBodyEdit(content: string, edit: BodyEdit): string {
	switch (edit.kind) {
		case 'details':
			return setDetails(content, edit.text);
		case 'checklist':
			return edit.items.reduce((c, item) => insertTask(c, item), content);
		case 'link':
			return appendLine(content, edit.line);
	}
}

/** Applies a frontmatter edit to a frontmatter object (for appliers that hand over an object, as Obsidian does). */
export function applyFrontmatterEdit(fm: Record<string, unknown>, edit: Plan['edits'][number]): void {
	for (const [key, value] of Object.entries(edit.set)) fm[key] = value;
	for (const key of edit.remove) delete fm[key];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const orNull = (v: unknown) => (v === undefined ? null : v);

/** Collects a plan and the changes it makes, property by property. */
export class PlanBuilder {
	readonly plan = emptyPlan();
	readonly changes: Change[] = [];

	/** A new note; its body is the body edits applied to an empty note. */
	create(path: string, frontmatter: Record<string, unknown>, bodyEdits: readonly BodyEdit[]): void {
		const entries = Object.entries(frontmatter);
		const body = bodyEdits.reduce(applyBodyEdit, '');
		this.plan.creates.push({ path, frontmatter: entries, body });
		this.changes.push({ kind: 'create', path });
		for (const [key, value] of entries) this.changes.push({ kind: 'property', path, key, from: null, to: value });
		for (const edit of bodyEdits) this.describeBody(path, '', edit);
	}

	/**
	 * Edits `mtm-` keys from `before` to `after`. When anything changes, keys in `explicit` are written too, even
	 * unchanged (status, type and Matter, as every plugin write names them); when nothing changes, nothing is planned.
	 */
	edit(path: string, before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>, explicit: readonly string[] = []): void {
		const set: Record<string, unknown> = {};
		const remove: string[] = [];
		const changes: Change[] = [];
		const keys = new Set([...Object.keys(before), ...Object.keys(after)].filter((k) => k.startsWith('mtm-')));
		for (const key of keys) {
			const from = before[key];
			const to = after[key];
			if (to === undefined) {
				if (from !== undefined) remove.push(key);
			} else if (!same(from, to) || explicit.includes(key)) set[key] = to;
			if (!same(from, to)) changes.push({ kind: 'property', path, key, from: orNull(from), to: orNull(to) });
		}
		if (!changes.length) return;
		this.plan.edits.push({ path, set, remove });
		this.changes.push(...changes);
	}

	body(path: string, content: string, edit: BodyEdit): void {
		this.plan.bodies.push({ path, edit });
		this.describeBody(path, content, edit);
	}

	rename(from: string, to: string): void {
		this.plan.renames.push({ from, to });
		this.changes.push({ kind: 'rename', from, to });
	}

	private describeBody(path: string, content: string, edit: BodyEdit): void {
		if (edit.kind === 'details') this.changes.push({ kind: 'details', path, from: getDetails(content), to: edit.text.trim() });
		else if (edit.kind === 'checklist') this.changes.push({ kind: 'checklist', path, added: [...edit.items] });
		else this.changes.push({ kind: 'link', path, line: edit.line });
	}
}
