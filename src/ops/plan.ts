// Building plans, and the pure pieces any applier uses: body edits and frontmatter edits.

import { appendLine, getDetails, insertTask, setDetails } from '../model/body';
import { hasNoteId, IDENTIFIED_KINDS, withNoteId } from '../services/notesModel';
import { foldName } from '../files/paths';
import type { BodyEdit, Change, Plan, Snapshot } from './types';

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

/**
 * Collects a plan and the changes it makes, property by property. With `newId` (the snapshot's), Actions and Matters
 * get an `mtm-id` when created, or with their first write when they have none.
 */
export class PlanBuilder {
	readonly plan = emptyPlan();
	readonly changes: Change[] = [];

	private readonly newId?: () => string;
	private readonly version?: (path: string) => string | null;
	private readonly basis = new Map<string, string | null>();

	/** `s` gives new IDs and file versions, when it has them. */
	constructor(s?: Pick<Snapshot, 'newId' | 'version' | 'settingsVersion'>) {
		if (s?.newId) this.newId = () => s.newId?.() ?? '';
		if (s?.version) {
			this.version = (path) => s.version?.(path) ?? null;
			if (s.settingsVersion !== undefined) this.plan.settingsVersion = s.settingsVersion;
		}
	}

	/**
	 * Records a file the plan depends on: at its version as read, or as a path that must not exist (`absent`). Files
	 * the plan writes are recorded on their own; operations add the ones whose content decided the outcome.
	 */
	rely(path: string, absent = false): void {
		if (!this.version || this.basis.has(path)) return;
		this.basis.set(path, absent ? null : this.version(path));
		this.plan.basis = [...this.basis].map(([p, version]) => ({ path: p, version }));
	}

	/** A new note's frontmatter with an `mtm-id` right after `mtm-kind`, when it is an Action or a Matter without one. */
	identify(frontmatter: Readonly<Record<string, unknown>>): Record<string, unknown> {
		return this.newId ? withNoteId(frontmatter, this.newId) : { ...frontmatter };
	}

	/** A new note; its body is the body edits applied to an empty note. */
	create(path: string, frontmatter: Record<string, unknown>, bodyEdits: readonly BodyEdit[]): void {
		const entries = Object.entries(frontmatter);
		const body = bodyEdits.reduce(applyBodyEdit, '');
		this.plan.creates.push({ path, frontmatter: entries, body });
		this.rely(path, true);
		this.changes.push({ kind: 'create', path });
		for (const [key, value] of entries) this.changes.push({ kind: 'property', path, key, from: null, to: value });
		for (const edit of bodyEdits) this.describeBody(path, '', edit);
	}

	/**
	 * Edits `mtm-` keys from `before` to `after`. When anything changes, keys in `explicit` are written too, even
	 * unchanged (status, type and Matter, as every plugin write names them); when nothing changes, nothing is planned.
	 * An Action or Matter written without an `mtm-id` gets one, added to `after` too.
	 */
	edit(path: string, before: Readonly<Record<string, unknown>>, after: Record<string, unknown>, explicit: readonly string[] = []): void {
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
		if (this.newId && IDENTIFIED_KINDS.includes(after['mtm-kind']) && !hasNoteId(after)) {
			const id = this.newId();
			after['mtm-id'] = id;
			set['mtm-id'] = id;
			changes.push({ kind: 'property', path, key: 'mtm-id', from: orNull(before['mtm-id']), to: id });
		}
		this.plan.edits.push({ path, set, remove });
		this.rely(path);
		this.changes.push(...changes);
	}

	/**
	 * Gives a note the plan writes in other ways (its body, a rename) the `mtm-id` it lacks, as a property write would;
	 * added to `after` too. Nothing when the plan already edits its properties.
	 */
	ensureId(path: string, after: Record<string, unknown>): void {
		if (!this.newId || !IDENTIFIED_KINDS.includes(after['mtm-kind']) || hasNoteId(after) || this.plan.edits.some((e) => e.path === path)) return;
		const id = this.newId();
		after['mtm-id'] = id;
		this.plan.edits.push({ path, set: { 'mtm-id': id }, remove: [] });
		this.rely(path);
		this.changes.push({ kind: 'property', path, key: 'mtm-id', from: null, to: id });
	}

	body(path: string, content: string, edit: BodyEdit): void {
		this.plan.bodies.push({ path, edit });
		this.rely(path);
		this.describeBody(path, content, edit);
	}

	rename(from: string, to: string): void {
		this.plan.renames.push({ from, to });
		this.rely(from);
		// A new name in another case or Unicode form is the same file; any other must still be free.
		if (foldName(from) !== foldName(to)) this.rely(to, true);
		this.changes.push({ kind: 'rename', from, to });
	}

	private describeBody(path: string, content: string, edit: BodyEdit): void {
		if (edit.kind === 'details') this.changes.push({ kind: 'details', path, from: getDetails(content), to: edit.text.trim() });
		else if (edit.kind === 'checklist') this.changes.push({ kind: 'checklist', path, added: [...edit.items] });
		else this.changes.push({ kind: 'link', path, line: edit.line });
	}
}
