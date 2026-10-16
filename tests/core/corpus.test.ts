// The corpus through the built bundle, evaluated where only the language's built-ins exist: every read of the
// fixture and every write case must answer as the sources do on Node, value, warnings, plan, changes and the files
// after the plan alike; every request and response must fit the boundary's schemas.

import { describe, expect, it } from 'vitest';
import { bundle } from './bundle';
import { expectAsSources } from './compare';
import { corpus, type CorpusEntry } from './corpus';

const core = await bundle();
const entries = corpus();

describe('the corpus through the bundle', () => {
	it('is large enough to mean something: reads, failures and every write case, with and without IDs', () => {
		expect(entries.length).toBeGreaterThan(150);
		expect(entries.filter((e) => !e.expected.result.ok).length).toBeGreaterThan(3);
		expect(entries.filter((e) => e.expected.files).length).toBeGreaterThanOrEqual(50);
		expect(entries.filter((e) => e.expected.result.ok && e.expected.result.plan.basis?.length).length).toBeGreaterThanOrEqual(25);
	});

	it('defines one global and nothing else', () => {
		expect(core.globals).toEqual(['mtmCore']);
	});

	it.each(entries.map((e) => [e.name, e] as [string, CorpusEntry]))('%s', (_name, e) => {
		expectAsSources(e, core.run(e.request));
	});
});
