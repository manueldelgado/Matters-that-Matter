// Builds the command line into one file, dist/mtm.mjs: the plugin's core and the packages it uses (chrono-node, yaml,
// the MCP library and what that needs) bundled in, so the package has no runtime dependencies. Next to it,
// dist/THIRD-PARTY-LICENSES.txt holds each bundled package's name, version and licence. Run from anywhere:
// `node cli/build.mjs`.

import esbuild from 'esbuild';
import { chmodSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { licencesText } from '../scripts/bundled-licences.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outfile = join(here, 'dist', 'mtm.mjs');

const result = await esbuild.build({
	entryPoints: [join(here, 'src', 'bin.ts')],
	outfile,
	bundle: true,
	format: 'esm',
	platform: 'node',
	target: 'node20',
	// Packages written as CommonJS may call require() for Node's own modules; give the ES module one.
	banner: { js: "#!/usr/bin/env node\nimport { createRequire as __mtmCreateRequire } from 'node:module';\nconst require = __mtmCreateRequire(import.meta.url);" },
	legalComments: 'none',
	metafile: true,
	// Input paths in the metafile are relative to this folder, wherever the build runs from.
	absWorkingDir: root,
	logLevel: 'warning',
	minify: false,
});
chmodSync(outfile, 0o755);

writeFileSync(
	join(here, 'dist', 'THIRD-PARTY-LICENSES.txt'),
	licencesText(result.metafile, root, 'matters-that-matter bundles the following packages into dist/mtm.mjs.'),
	'utf8',
);
