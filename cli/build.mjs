// Builds the command line into one file, dist/mtm.mjs: the plugin's core and the packages it uses (chrono-node, yaml,
// the MCP library and what that needs) bundled in, so the package has no runtime dependencies. Next to it,
// dist/THIRD-PARTY-LICENSES.txt holds each bundled package's name, version and licence. Run from anywhere:
// `node cli/build.mjs`.

import esbuild from 'esbuild';
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** The folder of each package with code in the bundle (the innermost `node_modules/<name>` of each input). */
function bundledPackages(metafile) {
	const folders = new Set();
	for (const [input, info] of Object.entries(metafile.outputs[Object.keys(metafile.outputs)[0]].inputs)) {
		if (!info.bytesInOutput) continue;
		const m = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
		if (m) folders.add(resolve(root, m[1]));
	}
	return [...folders];
}

function licenceOf(folder) {
	const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
	const file = readdirSync(folder).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
	const text = file ? readFileSync(join(folder, file), 'utf8').trim() : `Licence: ${pkg.license ?? 'not stated'} (the package has no licence file).`;
	return { name: pkg.name, version: pkg.version, licence: pkg.license ?? '', text };
}

const packages = bundledPackages(result.metafile)
	.filter((f) => existsSync(join(f, 'package.json')))
	.map(licenceOf)
	.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const rule = '-'.repeat(78);
writeFileSync(
	join(here, 'dist', 'THIRD-PARTY-LICENSES.txt'),
	[
		'matters-that-matter bundles the following packages into dist/mtm.mjs.',
		'Each is listed with its version and its licence.',
		'',
		...packages.flatMap((p) => [rule, `${p.name} ${p.version}${p.licence ? ` (${p.licence})` : ''}`, rule, '', p.text, '']),
	].join('\n'),
	'utf8',
);
