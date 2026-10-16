// The licences of the packages an esbuild bundle holds, for the THIRD-PARTY-LICENSES.txt next to it: each package with
// code in the bundle (from the build's metafile), with its name, version and licence text.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The folder of each package with code in the bundle (the innermost `node_modules/<name>` of each input). */
function bundledPackages(metafile, root) {
	const folders = new Set();
	// The bundle itself, not its source map.
	const output = Object.keys(metafile.outputs).find((path) => !path.endsWith('.map'));
	for (const [input, info] of Object.entries(metafile.outputs[output].inputs)) {
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

/**
 * The text of THIRD-PARTY-LICENSES.txt for a build: `heading` first, then each bundled package. `root` is the
 * build's working directory, which the metafile's input paths are relative to.
 */
export function licencesText(metafile, root, heading) {
	const packages = bundledPackages(metafile, root)
		.filter((f) => existsSync(join(f, 'package.json')))
		.map(licenceOf)
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	const rule = '-'.repeat(78);
	return [heading, 'Each is listed with its version and its licence.', '', ...packages.flatMap((p) => [rule, `${p.name} ${p.version}${p.licence ? ` (${p.licence})` : ''}`, rule, '', p.text, ''])].join('\n');
}
