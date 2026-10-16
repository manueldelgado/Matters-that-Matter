// The core bundle's one way in: a JSON request naming an operation, its input and a snapshot of the vault (handed
// over whole, or held by the core from an earlier `openSnapshot`); a JSON response with the result, warnings, plan and
// changes, or an error. Nothing is ever thrown: a request that can't be read, a snapshot that contradicts itself and
// a bug alike come back as a failure value. No files, no clock and no randomness; the caller supplies the vault, the
// time and new IDs, and writes what the plan says. The only state is the held snapshots (core/src/held.ts).

import { mergeNote } from '../../src/files/merge';
import { contentsAfter, WriteError } from '../../src/files/write';
import { addAction, addMatter, emptyPlan, getAction, getWorkflow, listActions, listMatters, markAsDone, reopen, today, updateAction } from '../../src/ops';
import type { OpResult } from '../../src/ops/types';
import requestSchema from '../schema/request.json';
import { BOUNDARY, type CoreError, type CoreOp, type CoreRequest, type CoreResponse, type Failure, type VaultRequest } from './boundary';
import { changeHeld, closeHeld, exportHeld, heldSnapshot, openHeld } from './held';
import { openSnapshot, SnapshotError, type OpenedSnapshot } from './snapshot';
import { Validator } from './validate';

export { BOUNDARY };

const validator = new Validator(requestSchema);

const OPS: readonly CoreOp[] = [
	'addAction',
	'updateAction',
	'markAsDone',
	'reopenAction',
	'getAction',
	'listActions',
	'getToday',
	'addMatter',
	'listMatters',
	'getWorkflow',
	'mergeNote',
	'openSnapshot',
	'changeSnapshot',
	'exportCache',
	'closeSnapshot',
];

const fail = (error: CoreError, op?: CoreOp): Failure => ({ boundary: BOUNDARY, ok: false, ...(op ? { op } : {}), error });

/** The request's operation, when it names one the core knows. */
function opOf(request: unknown): CoreOp | undefined {
	const op = request !== null && typeof request === 'object' ? (request as { op?: unknown }).op : undefined;
	return OPS.find((known) => known === op);
}

/** The vault a request runs on: handed over whole, or held. */
function vaultOf(r: VaultRequest): OpenedSnapshot {
	if (r.snapshot && r.held) throw new SnapshotError('bad-request', 'Give the snapshot or a held one, not both.', '/held');
	if (r.held) return heldSnapshot(r.held);
	if (r.snapshot) return openSnapshot(r.snapshot);
	throw new SnapshotError('bad-request', '/snapshot is required, or /held: a snapshot the core holds.', '/snapshot');
}

/** An answer with nothing to write. */
const settledAnswer = (op: CoreOp, value: unknown): CoreResponse => ({ boundary: BOUNDARY, ok: true, op, value, warnings: [], plan: emptyPlan(), changes: [], idsUsed: 0 }) as CoreResponse;

function answer(r: VaultRequest): CoreResponse {
	const opened = vaultOf(r);
	const s = opened.snapshot;
	let result: OpResult<unknown>;
	switch (r.op) {
		case 'addAction':
			result = addAction(r.input, s);
			break;
		case 'updateAction':
			result = updateAction(r.input, s);
			break;
		case 'markAsDone':
			result = markAsDone(r.input.action, s);
			break;
		case 'reopenAction':
			result = reopen(r.input.action, s);
			break;
		case 'getAction':
			result = getAction(r.input.action, s);
			break;
		case 'listActions':
			result = listActions(r.input, s);
			break;
		case 'getToday':
			result = today(s);
			break;
		case 'addMatter':
			result = addMatter(r.input, s);
			break;
		case 'listMatters':
			result = listMatters(s);
			break;
		case 'getWorkflow':
			result = getWorkflow(s);
			break;
	}
	if (!result.ok) return fail(result.error, r.op);
	const files = 'apply' in r && r.apply ? contentsAfter(result.plan, opened.reader, { configDir: opened.configDir, links: opened.links }) : undefined;
	return {
		boundary: BOUNDARY,
		ok: true,
		op: r.op,
		value: result.value,
		warnings: result.warnings,
		plan: result.plan,
		changes: result.changes,
		idsUsed: opened.idsUsed(),
		...(files ? { files } : {}),
	} as CoreResponse;
}

/** One request, as a value: never throws. */
export function handle(text: unknown): CoreResponse {
	let request: unknown;
	try {
		if (typeof text !== 'string') return fail({ code: 'bad-request', message: 'The request must be a JSON string.' });
		request = JSON.parse(text);
	} catch (error) {
		return fail({ code: 'bad-request', message: `The request is not valid JSON: ${error instanceof Error ? error.message : String(error)}` });
	}
	const op = opOf(request);
	const boundary = request !== null && typeof request === 'object' ? (request as { boundary?: unknown }).boundary : undefined;
	if (boundary !== undefined && boundary !== BOUNDARY) {
		const given = JSON.stringify(boundary);
		return fail({ code: 'unsupported-boundary', value: given, message: `This core speaks boundary version ${BOUNDARY}, not ${given}.` }, op);
	}
	try {
		const miss = validator.check(request);
		if (miss) return fail({ code: 'bad-request', field: miss.at, message: `${miss.at || 'The request'} ${miss.message}.` }, op);
		const r = request as CoreRequest;
		switch (r.op) {
			case 'mergeNote':
				return settledAnswer(r.op, mergeNote(r.input));
			case 'openSnapshot':
				return settledAnswer(r.op, openHeld(r.snapshot, r.input.cache));
			case 'changeSnapshot':
				return settledAnswer(r.op, changeHeld(r.input));
			case 'exportCache':
				return settledAnswer(r.op, exportHeld(r.input.handle));
			case 'closeSnapshot':
				return settledAnswer(r.op, closeHeld(r.input.handle));
			default:
				return answer(r);
		}
	} catch (error) {
		if (error instanceof SnapshotError) return fail({ code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) }, op);
		if (error instanceof WriteError) return fail({ code: 'write-failed', writeCode: error.code, path: error.path, message: error.message }, op);
		const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		return fail({ code: 'internal', message: `Something went wrong in the core: ${message}` }, op);
	}
}

/** One request in, one response out, both JSON text. Never throws. */
export function call(text: string): string {
	const response = handle(text);
	try {
		return JSON.stringify(response);
	} catch (error) {
		return JSON.stringify(fail({ code: 'internal', message: `The response could not be written as JSON: ${error instanceof Error ? error.message : String(error)}` }, response.op));
	}
}
