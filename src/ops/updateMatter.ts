// Change a Matter's own fields, as its overview does: icon, state, outcome, review rhythm and Sphere. Only the fields
// given change; null removes the outcome, the rhythm or the Sphere, and an empty value is refused. It is strict, like
// updating an Action: a value that matches nothing is refused and nothing is planned. The Inbox has only its icon.

import { formatCadence, parseCadence, parseOutcome, type MatterState } from '../model/matters';
import { STRINGS } from '../strings';
import { fail, findMatter, findSphere, isBlank, readiness } from './fields';
import { publicField } from './fieldNames';
import { matterInfoAfter, missingNote } from './matterWrite';
import { PlanBuilder } from './plan';
import { matterSummary } from './summaries';
import type { MatterWrite, OpError, OpResult, Snapshot, UpdateMatterInput } from './types';
import { vaultView } from './vaultView';

const T = STRINGS.ops;
const STATES: readonly MatterState[] = ['active', 'dormant', 'closed'];
const FIELDS = ['icon', 'state', 'outcome', 'reviewEvery', 'sphere'] as const;

const invalid = (field: string, value: unknown, message: string): { ok: false; error: OpError } =>
	fail({ code: 'invalid', field: publicField(field), ...(typeof value === 'string' ? { value } : {}), message });

export function updateMatter(input: UpdateMatterInput, s: Snapshot): OpResult<MatterWrite> {
	const ready = readiness(s, true);
	if (ready.error) return { ok: false, error: ready.error };
	const found = findMatter(input.matter, s);
	if (!found.ok) return found;
	const matter = found.value;

	const given = FIELDS.filter((f) => input[f] !== undefined);
	if (!given.length) return fail({ code: 'invalid', message: T.nothingToChange });
	const notIcon = given.find((f) => f !== 'icon');
	if (matter.isInbox && notIcon) return invalid(notIcon, input[notIcon], T.inboxOnlyIcon(publicField(notIcon)));
	const blank = given.find((f) => isBlank(input[f]));
	if (blank) return invalid(blank, input[blank], T.emptyValue(publicField(blank)));

	const view = vaultView(s);
	const note = view.byPath.get(matter.path);
	if (!note) return missingNote(matter.path, input.matter);
	const before = note.frontmatter ?? {};
	const after: Record<string, unknown> = { ...before };

	if (input.icon !== undefined) {
		const icon = input.icon.trim();
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(icon)) return invalid('icon', input.icon, T.badIcon(input.icon));
		after['mtm-icon'] = icon;
	}
	if (input.state !== undefined) {
		const state = STATES.find((x) => x === input.state?.trim().toLowerCase());
		if (!state) return invalid('state', input.state, T.badState(input.state));
		after['mtm-state'] = state;
	}
	if (input.outcome !== undefined) {
		const outcome = parseOutcome(input.outcome);
		if (outcome) after['mtm-outcome'] = outcome;
		else delete after['mtm-outcome'];
	}
	if (input.reviewEvery !== undefined) {
		if (input.reviewEvery === null) delete after['mtm-review-every'];
		else {
			const cadence = parseCadence(input.reviewEvery);
			if (!cadence) return invalid('reviewEvery', input.reviewEvery, T.badRhythm(input.reviewEvery));
			after['mtm-review-every'] = formatCadence(cadence);
		}
	}
	if (input.sphere !== undefined) {
		if (input.sphere === null) delete after['mtm-sphere'];
		else {
			const sphere = findSphere(input.sphere.trim(), s);
			if (!sphere.ok) return sphere;
			after['mtm-sphere'] = sphere.value.id;
		}
	}

	const builder = new PlanBuilder(s);
	builder.edit(matter.path, before, after);
	const value = matterSummary(matterInfoAfter(matter, after, s), view.actionsByMatter.get(matter.path) ?? [], s, after);
	return { ok: true, value: { matter: value, changed: builder.changes.length > 0 }, plan: builder.plan, changes: builder.changes, warnings: ready.warnings };
}
