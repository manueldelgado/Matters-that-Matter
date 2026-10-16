// The corpus in JavaScriptCore itself, where a `jsc` shell is at hand (macOS); skipped elsewhere. The bundle is
// loaded as a plain script and every request goes through `mtmCore.call`, as an app's JavaScript context would run it.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import type { CoreResponse } from '../../core/src/boundary';
import { bundle } from './bundle';
import { expectAsSources } from './compare';
import { corpus, type CorpusEntry } from './corpus';

const JSC = process.env.MTM_JSC ?? '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc';

/** Loads the bundle, answers each request line, and writes the answers, one per line. */
const DRIVER = `
const [core, requests, out] = arguments;
load(core);
const answers = readFile(requests).split('\\n').filter((line) => line !== '').map((line) => mtmCore.call(line));
writeFile(out, answers.join('\\n'));
`;

describe.skipIf(!existsSync(JSC))('the corpus in JavaScriptCore', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'mtm-core-jsc-'));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));
	const entries = corpus();
	const paths = { core: join(dir, 'mtm-core.js'), requests: join(dir, 'requests.jsonl'), out: join(dir, 'answers.jsonl'), driver: join(dir, 'driver.js') };
	writeFileSync(paths.core, (await bundle()).code);
	writeFileSync(paths.requests, entries.map((e) => JSON.stringify(e.request)).join('\n'));
	writeFileSync(paths.driver, DRIVER);
	execFileSync(JSC, [paths.driver, '--', paths.core, paths.requests, paths.out], { maxBuffer: 1 << 28 });
	const answers = readFileSync(paths.out, 'utf8').split('\n');

	it.each(entries.map((e, i) => [e.name, e, i] as [string, CorpusEntry, number]))('%s', (_name, e, i) => {
		expectAsSources(e, JSON.parse(answers[i] ?? 'null') as CoreResponse);
	});
});
