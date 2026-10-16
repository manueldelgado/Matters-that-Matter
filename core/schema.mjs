// The JSON Schemas of the core bundle's boundary, generated from its TypeScript types (core/src/boundary.ts):
// core/schema/request.json and core/schema/response.json. Run `npm run schema:core` after changing the types or
// anything they reach; a test fails while the files are out of date.

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGenerator } from 'ts-json-schema-generator';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
export const SCHEMA_DIR = join(here, 'schema');

/** Each schema's file and the type it describes. */
export const SCHEMAS = [
	{ file: 'request.json', type: 'CoreRequest', id: 'request' },
	{ file: 'response.json', type: 'CoreResponse', id: 'response' },
];

/** The schemas as text: tab-indented JSON with a final line break. */
export function generateSchemas() {
	const generator = createGenerator({
		path: join(here, 'src', 'boundary.ts'),
		tsconfig: join(root, 'tsconfig.json'),
		type: '*',
		expose: 'export',
		topRef: true,
		jsDoc: 'extended',
		sortProps: true,
		skipTypeCheck: true,
		additionalProperties: false,
	});
	return SCHEMAS.map(({ file, type, id }) => {
		const schema = generator.createSchema(type);
		const text = `${JSON.stringify({ $id: `mtm-core/${id}`, ...schema }, null, '\t')}\n`;
		return { file, text };
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	for (const { file, text } of generateSchemas()) writeFileSync(join(SCHEMA_DIR, file), text, 'utf8');
}
