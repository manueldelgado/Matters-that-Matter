// Builds the core into one script, dist/mtm-core.js: the pure rules, the operations and the files layer, with the
// packages they use (chrono-node, yaml) bundled in, for any JavaScript host, JavaScriptCore included. It needs no
// Node, no Obsidian, no module loader, no timers and no `crypto`: evaluated as a plain script, it defines one global,
// `mtmCore`, whose `call(requestJson)` returns the response as JSON (see core/src/entry.ts and core/schema/). Next to
// it, dist/THIRD-PARTY-LICENSES.txt lists each bundled package and its licence. Run from anywhere:
// `node core/build.mjs`.

import esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { licencesText } from '../scripts/bundled-licences.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
export const OUTFILE = join(here, 'dist', 'mtm-core.js');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** The build, also used by the tests, which build in memory (`write: false`) and run the result. */
export function coreBuildOptions() {
	return {
		entryPoints: [join(here, 'src', 'entry.ts')],
		outfile: OUTFILE,
		bundle: true,
		format: 'iife',
		globalName: 'mtmCore',
		// No platform's built-ins: a Node or browser module the core reached would fail the build.
		platform: 'neutral',
		mainFields: ['module', 'main'],
		target: 'es2021',
		// Globals that hosts such as JavaScriptCore lack, replaced on every host so the bundle behaves the same everywhere.
		inject: [join(here, 'src', 'shims.ts')],
		banner: { js: `// Matters that Matter core ${version}. MIT licence; bundled packages: THIRD-PARTY-LICENSES.txt.` },
		legalComments: 'none',
		metafile: true,
		absWorkingDir: root,
		logLevel: 'warning',
		minify: true,
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const result = await esbuild.build({ ...coreBuildOptions(), sourcemap: 'external' });
	writeFileSync(
		join(here, 'dist', 'THIRD-PARTY-LICENSES.txt'),
		licencesText(result.metafile, root, 'The core of Matters that Matter bundles the following packages into dist/mtm-core.js.'),
		'utf8',
	);
}
