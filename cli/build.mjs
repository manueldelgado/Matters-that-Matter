// Builds the command line into one file, dist/mtm.mjs: the plugin's core, chrono-node and yaml bundled in, so the
// package has no runtime dependencies. Run from anywhere: `node cli/build.mjs`.

import esbuild from 'esbuild';
import { chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outfile = join(here, 'dist', 'mtm.mjs');

await esbuild.build({
	entryPoints: [join(here, 'src', 'bin.ts')],
	outfile,
	bundle: true,
	format: 'esm',
	platform: 'node',
	target: 'node20',
	// Packages written as CommonJS may call require() for Node's own modules; give the ES module one.
	banner: { js: "#!/usr/bin/env node\nimport { createRequire as __mtmCreateRequire } from 'node:module';\nconst require = __mtmCreateRequire(import.meta.url);" },
	legalComments: 'none',
	logLevel: 'warning',
	minify: false,
});
chmodSync(outfile, 0o755);
