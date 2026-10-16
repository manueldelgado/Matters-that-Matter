// A response from the bundle checked against what the sources answered, and against the boundary's schemas.

import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import type { CoreResponse } from '../../core/src/boundary';
import type { CorpusEntry } from './corpus';

const schema = (name: string) => JSON.parse(readFileSync(new URL(`../../core/schema/${name}.json`, import.meta.url), 'utf8')) as object;
const ajv = new Ajv({ strict: false });
const validRequest = ajv.compile(schema('request'));
const validResponse = ajv.compile(schema('response'));

/** A value as it comes back through JSON: undefined fields left out. */
const asJson = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

export function expectAsSources(e: CorpusEntry, response: CoreResponse): void {
	expect(validRequest(e.request), ajv.errorsText(validRequest.errors)).toBe(true);
	expect(validResponse(response), ajv.errorsText(validResponse.errors)).toBe(true);
	const r = e.expected.result;
	if (!r.ok) {
		expect(response).toEqual({ boundary: 1, ok: false, op: e.request.op, error: asJson(r.error) });
		return;
	}
	expect(response.ok, JSON.stringify(response)).toBe(true);
	if (!response.ok) return;
	expect(response.value).toEqual(asJson(r.value));
	expect(response.warnings).toEqual(asJson(r.warnings));
	expect(response.plan).toEqual(asJson(r.plan));
	expect(response.changes).toEqual(asJson(r.changes));
	expect(response.files).toEqual(asJson(e.expected.files));
	const r0 = e.request as { snapshot?: { ids?: string[] }; held?: { ids?: string[] } };
	const ids = r0.held?.ids ?? r0.snapshot?.ids ?? [];
	expect(response.idsUsed).toBe(ids.filter((id) => JSON.stringify(r.plan).includes(id)).length);
}
