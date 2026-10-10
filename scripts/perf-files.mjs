#!/usr/bin/env node
// Times the file index on a generated vault of 5,000 notes: the fixture vault's notes copied into numbered folders
// (so names repeat and links resolve by path, the slow case), in a temporary folder that is removed afterwards.
//
//   npm run perf            (fails above the budget)
//   node scripts/perf-files.mjs [--notes 5000] [--budget 1500]

import { build } from 'esbuild';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFixtureVault } from './fixture-vault.mjs';

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 ? Number(args[i + 1]) : fallback;
};
const NOTES = option('--notes', 5000);
const BUDGET_MS = option('--budget', 1500);

async function loadIndex() {
	const result = await build({
		stdin: { contents: `export { VaultIndex } from './files/index';`, resolveDir: join(pluginDir, 'src'), loader: 'ts' },
		bundle: true,
		format: 'esm',
		platform: 'neutral',
		mainFields: ['module', 'main'],
		write: false,
		logLevel: 'error',
	});
	return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

/** Every file under `dir`, as vault paths. */
function walk(dir, prefix = '') {
	return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		return entry.isDirectory() ? walk(dir, rel) : [rel];
	});
}

const { VaultIndex } = await loadIndex();
const work = mkdtempSync(join(tmpdir(), 'mtm-perf-'));
try {
	const sample = join(work, 'sample');
	await writeFixtureVault({ dir: sample });
	const perCopy = walk(sample).filter((p) => p.endsWith('.md')).length;
	const vaultDir = join(work, 'perf-vault');
	cpSync(join(sample, '.obsidian'), join(vaultDir, '.obsidian'), { recursive: true });
	cpSync(join(sample, 'MTM'), join(vaultDir, 'MTM'), { recursive: true });
	for (let copy = 1; copy * perCopy < NOTES; copy++) cpSync(join(sample, 'MTM'), join(vaultDir, `Copy ${String(copy).padStart(3, '0')}`, 'MTM'), { recursive: true });
	let files = walk(vaultDir);
	// Trim to exactly the number asked for, dropping the last notes in listing order.
	const notes = files.filter((p) => p.endsWith('.md'));
	const drop = new Set(notes.slice(NOTES));
	files = files.filter((p) => !drop.has(p));
	const count = files.filter((p) => p.endsWith('.md')).length;

	const started = performance.now();
	const index = new VaultIndex({ list: () => walk(vaultDir).filter((p) => !drop.has(p)), read: (path) => readFileSync(join(vaultDir, path), 'utf8') }, { configDir: '.obsidian' });
	const built = performance.now();
	let links = 0;
	for (const path of index.notePaths) links += Object.values(index.resolvedLinks(path)).reduce((a, b) => a + b, 0);
	const done = performance.now();

	const total = done - started;
	process.stdout.write(`${count} notes, ${index.files.length} files, ${links} resolved links\n`);
	process.stdout.write(`listing, reading and properties: ${(built - started).toFixed(0)} ms; bodies and link resolution: ${(done - built).toFixed(0)} ms\n`);
	process.stdout.write(`total: ${total.toFixed(0)} ms (budget ${BUDGET_MS} ms)\n`);
	if (count !== NOTES) throw new Error(`Generated ${count} notes, not ${NOTES}`);
	if (total > BUDGET_MS) {
		process.stderr.write('Over budget\n');
		process.exitCode = 1;
	}
} finally {
	rmSync(work, { recursive: true, force: true });
}
