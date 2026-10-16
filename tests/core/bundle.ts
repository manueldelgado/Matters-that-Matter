// The core bundle as the tests run it: built in memory with the same options as `npm run build:core`, and evaluated
// as a plain script in a fresh JavaScript context that has the language's built-ins and nothing else (no Node
// globals, no `URL`, no `structuredClone`, no timers, no `crypto`), as a bare JavaScriptCore context has.

import esbuild from 'esbuild';
import { createContext, runInContext } from 'node:vm';
// @ts-expect-error: a build script with no type declarations.
import { coreBuildOptions } from '../../core/build.mjs';
import type { CoreResponse } from '../../core/src/boundary';

export interface Bundle {
	/** The script's text. */
	code: string;
	/** The bundle's entry point: JSON in, JSON out. */
	call(json: string): string;
	/** A request through the bundle, as values; malformed ones too. */
	run(request: unknown): CoreResponse;
	/** The names the script defined in its context. */
	globals: string[];
}

let built: Promise<Bundle> | null = null;

async function build(): Promise<Bundle> {
	const options = (coreBuildOptions as () => esbuild.BuildOptions)();
	const result = await esbuild.build({ ...options, write: false, metafile: false });
	const code = result.outputFiles?.[0]?.text;
	if (!code) throw new Error('The build wrote nothing.');
	const context = createContext({});
	const before = new Set(Object.getOwnPropertyNames(runInContext('globalThis', context) as object));
	runInContext(code, context, { filename: 'mtm-core.js' });
	const global = runInContext('globalThis', context) as Record<string, unknown>;
	const globals = Object.getOwnPropertyNames(global).filter((name) => !before.has(name));
	const core = global.mtmCore as { call(json: string): string };
	const call = (json: string) => core.call(json);
	return { code, call, run: (request) => JSON.parse(call(JSON.stringify(request))) as CoreResponse, globals };
}

/** The bundle, built once per test file. */
export function bundle(): Promise<Bundle> {
	built ??= build();
	return built;
}
