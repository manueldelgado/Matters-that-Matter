// The boundary's JSON Schemas are generated from its types: the checked-in files must be what the types say now.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a build script with no type declarations.
import { generateSchemas, SCHEMA_DIR } from '../../core/schema.mjs';

const generated = (generateSchemas as () => { file: string; text: string }[])();

describe('the boundary schemas', () => {
	it.each(generated.map((g) => [g.file, g.text] as [string, string]))('%s is up to date (otherwise run npm run schema:core)', (file, text) => {
		expect(readFileSync(join(SCHEMA_DIR as string, file), 'utf8')).toBe(text);
	});

	it('name every operation in the request and the response', () => {
		const [request, response] = generated.map((g) => JSON.stringify(JSON.parse(g.text)));
		for (const op of ['addAction', 'updateAction', 'markAsDone', 'reopenAction', 'getAction', 'listActions', 'getToday', 'addMatter', 'listMatters', 'getWorkflow', 'mergeNote']) {
			expect(request).toContain(`"const":"${op}"`);
			expect(response).toContain(`"const":"${op}"`);
		}
	});
});
