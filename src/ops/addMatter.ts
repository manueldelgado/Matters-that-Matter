// Add a Matter: name, icon, Sphere, state (active by default), outcome and review rhythm; last in lane order, as
// "New Matter" does. A Sphere that matches nothing leaves the Matter without one, with a warning.

import { formatCadence, nextLaneOrder, parseCadence, parseOutcome, type MatterState } from '../model/matters';
import { sanitiseTitle, uniqueTitle } from '../model/titles';
import { matchDefined } from '../services/match';
import { DEFAULT_MATTER_ICON, laneOf, matterInfo, newMatterFrontmatter } from '../services/notesModel';
import { STRINGS } from '../strings';
import { fail, readText, readiness } from './fields';
import { publicField } from './fieldNames';
import { PlanBuilder } from './plan';
import { matterSummary } from './summaries';
import type { AddMatterInput, MatterSummary, OpResult, Snapshot, Warning } from './types';
import { joinPath, vaultView } from './vaultView';

const T = STRINGS.ops;
const STATES: readonly MatterState[] = ['active', 'dormant', 'closed'];

export function addMatter(input: AddMatterInput, s: Snapshot): OpResult<MatterSummary> {
	const ready = readiness(s, true);
	if (ready.error) return { ok: false, error: ready.error };
	const warnings: Warning[] = [...ready.warnings];
	const { settings } = s;

	const name = readText('name', input.name);
	if (!name.ok) return name;
	if (!name.value.trim()) return fail({ code: 'invalid', field: 'name', message: T.noName });

	let icon = DEFAULT_MATTER_ICON;
	if (input.icon !== undefined && input.icon.trim() !== '') {
		icon = input.icon.trim();
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(icon)) return fail({ code: 'invalid', field: 'icon', value: input.icon, message: T.badIcon(input.icon) });
	}

	let state: MatterState = 'active';
	if (input.state !== undefined && input.state.trim() !== '') {
		const value = input.state.trim().toLowerCase();
		const found = STATES.find((x) => x === value);
		if (!found) return fail({ code: 'invalid', field: 'state', value: input.state, message: T.badState(input.state) });
		state = found;
	}

	let reviewEvery: string | null = null;
	if (input.reviewEvery !== undefined && input.reviewEvery.trim() !== '') {
		const cadence = parseCadence(input.reviewEvery);
		if (!cadence) return fail({ code: 'invalid', field: publicField('reviewEvery'), value: input.reviewEvery, message: T.badRhythm(input.reviewEvery) });
		reviewEvery = formatCadence(cadence);
	}

	let sphereId: string | null = null;
	if (input.sphere !== undefined && input.sphere.trim() !== '') {
		const m = matchDefined(input.sphere, settings.spheres);
		if (m.kind === 'ambiguous') {
			return fail({ code: 'ambiguous', field: 'sphere', value: input.sphere, message: T.severalSpheres(input.sphere), candidates: m.items.map((x) => x.label) });
		}
		if (m.kind === 'match') sphereId = m.item.id;
		else warnings.push({ code: 'unmatched-sphere', field: 'sphere', value: input.sphere, message: T.noSphere(input.sphere) });
	}

	const outcome = input.outcome === undefined ? null : parseOutcome(input.outcome);

	const base = sanitiseTitle(name.value) || STRINGS.untitledMatter;
	const folder = settings.folders.matters;
	const title = uniqueTitle(base, (t) => s.exists(joinPath(folder, `${t}.md`)));
	const path = joinPath(folder, `${title}.md`);
	const lanes = s.notes.filter((n) => n.frontmatter?.['mtm-kind'] === 'matter').map((n) => laneOf(n, settings.inboxPath));
	const fm = newMatterFrontmatter({ icon, state, reviewEvery, sphereId, outcome }, nextLaneOrder(lanes));

	const builder = new PlanBuilder();
	builder.create(path, fm, []);
	const view = vaultView(s);
	const matter = matterInfo({ path, basename: title, frontmatter: fm }, settings, view.today);
	return { ok: true, value: matterSummary(matter, [], s), plan: builder.plan, changes: builder.changes, warnings };
}
