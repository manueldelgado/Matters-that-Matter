// The write cases (tests/fixtures/write-cases.json): each runs one operation on the fixture vault, as other tools
// would call it, and applies the plan with the files layer. The plans, with the body text each body edit leaves, are
// what an Obsidian console script applies to a copy of the fixture to produce the expected results.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitFrontmatter } from '../../src/model/body';
import { stripBom } from '../../src/files/frontmatter';
import { VaultIndex, type VaultReader } from '../../src/files/index';
import { filesSnapshot } from '../../src/files/snapshot';
import { contentsAfter, treeAfter, type FileOutcome } from '../../src/files/write';
import { addAction, addMatter, inputKey, markAsDone, reopen, updateAction } from '../../src/ops/index';
import type { BodyEdit, OpResult, Plan } from '../../src/ops/types';
import { migrateSettings } from '../../src/services/migrations';

const root = fileURLToPath(new URL('../..', import.meta.url));
export const FIXTURE = join(root, 'tests/fixtures/mtm-fixture');
export const CASES_FILE = join(root, 'tests/fixtures/write-cases.json');
export const PLANS = join(root, 'tests/fixtures/expected/plans');
export const WRITES = join(root, 'tests/fixtures/expected/writes');
export const CONFIG_DIR = '.obsidian';

export type CaseOp = 'addAction' | 'updateAction' | 'markAsDone' | 'reopen' | 'addMatter';

export interface WriteCase {
	name: string;
	description?: string;
	op: CaseOp;
	/** As another tool passes it: public field names (`waiting-on`, `review-every`). */
	input: Record<string, unknown>;
	/** The clock, local time (`YYYY-MM-DDTHH:mm`). */
	now: string;
	/** Obsidian's "Automatically update internal links" for this case; the fixture's (on) when absent. */
	alwaysUpdateLinks?: boolean;
	/** Notes added to the fixture before the operation runs, by path. */
	setup?: Record<string, string>;
}

/** A plan as the Obsidian script applies it: each body edit carries the body text it leaves. */
export interface CasePlan {
	case: string;
	description: string | null;
	alwaysUpdateLinks: boolean;
	setup: Record<string, string>;
	plan: Omit<Plan, 'bodies'> & { bodies: { path: string; edit: BodyEdit; bodyAfter: string }[] };
}

export interface CaseRun {
	result: OpResult<unknown>;
	plan: Plan;
	outcome: FileOutcome;
	casePlan: CasePlan;
	/** Every file the plan wrote, by path after the plan, and the paths it moved away. */
	written: Map<string, string>;
	removed: string[];
	reader: VaultReader;
}

export function loadCases(): WriteCase[] {
	return JSON.parse(readFileSync(CASES_FILE, 'utf8')) as WriteCase[];
}

function walk(dir: string, prefix = ''): string[] {
	return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		return entry.isDirectory() ? walk(dir, rel) : [rel];
	});
}

const fixtureFiles = walk(FIXTURE);

/** The fixture as the case sees it: its setup notes added, `app.json` as the case says. */
export function caseReader(c: WriteCase): VaultReader {
	const extra = c.setup ?? {};
	const files = [...new Set([...fixtureFiles, ...Object.keys(extra)])];
	return {
		list: () => files,
		read: (path) => {
			if (path in extra) return extra[path] ?? null;
			const text = readFileSync(join(FIXTURE, path), 'utf8');
			if (path === `${CONFIG_DIR}/app.json` && c.alwaysUpdateLinks !== undefined) {
				return `${JSON.stringify({ ...(JSON.parse(text) as object), alwaysUpdateLinks: c.alwaysUpdateLinks }, null, 2)}\n`;
			}
			return text;
		},
	};
}

/** Public field names to the operations' keys. */
function inputOf(c: WriteCase): Record<string, unknown> {
	return Object.fromEntries(Object.entries(c.input).map(([k, v]) => [inputKey(k), v]));
}

function runOp(c: WriteCase, reader: VaultReader): OpResult<unknown> {
	const index = new VaultIndex(reader, { configDir: CONFIG_DIR });
	const settings = migrateSettings(JSON.parse(reader.read(`${CONFIG_DIR}/plugins/matters-that-matter/data.json`) ?? '{}'));
	const s = filesSnapshot(index, settings, new Date(c.now));
	const input = inputOf(c);
	switch (c.op) {
		case 'addAction':
			return addAction(input, s);
		case 'updateAction':
			return updateAction(input as unknown as Parameters<typeof updateAction>[0], s);
		case 'markAsDone':
			return markAsDone(String(input.action), s);
		case 'reopen':
			return reopen(String(input.action), s);
		case 'addMatter':
			return addMatter(input as unknown as Parameters<typeof addMatter>[0], s);
	}
}

/** The body text (after the properties block) a note holds once the plan's body edits up to `upTo` are applied. */
function bodyAfter(plan: Plan, upTo: number, reader: VaultReader): string {
	const partial: Plan = { creates: plan.creates, edits: plan.edits, bodies: plan.bodies.slice(0, upTo + 1), renames: [] };
	const path = plan.bodies[upTo]?.path ?? '';
	const file = contentsAfter(partial, reader, { configDir: CONFIG_DIR }).files.find((f) => f.path === path);
	return splitFrontmatter(stripBom(file?.after ?? '')).body;
}

export function runCase(c: WriteCase): CaseRun {
	const reader = caseReader(c);
	const result = runOp(c, reader);
	if (!result.ok) throw new Error(`${c.name}: ${result.error.code}: ${result.error.message}`);
	const plan = result.plan;
	const outcome = contentsAfter(plan, reader, { configDir: CONFIG_DIR });
	const { written, removed } = treeAfter(outcome);
	const casePlan: CasePlan = {
		case: c.name,
		description: c.description ?? null,
		alwaysUpdateLinks: c.alwaysUpdateLinks ?? true,
		setup: c.setup ?? {},
		plan: { ...plan, bodies: plan.bodies.map((b, i) => ({ ...b, bodyAfter: bodyAfter(plan, i, reader) })) },
	};
	return { result, plan, outcome, casePlan, written, removed, reader };
}

/** A plan file's text: tab-indented JSON with a final line break. */
export const planText = (p: CasePlan): string => `${JSON.stringify(p, null, '\t')}\n`;
