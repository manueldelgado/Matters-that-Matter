// What the core needs from a JavaScript host beyond the language itself, written in JavaScript, for hosts that don't
// offer it (a bare JavaScriptCore context has no `URL`, no `structuredClone` and may have no `console`): the bundle
// uses these in place of the globals of the same names, on every host, so it behaves the same everywhere.

import { WebURL } from './webUrl';

/** A deep copy of plain data (objects, arrays and primitives), all the core copies with `structuredClone`. */
export function structuredClone<T>(value: T): T {
	if (Array.isArray(value)) return value.map((v: unknown) => structuredClone(v)) as T;
	if (value !== null && typeof value === 'object') {
		const copy: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) copy[k] = structuredClone(v);
		return copy as T;
	}
	return value;
}

export { WebURL as URL };

type Log = (...args: unknown[]) => void;
const hostConsole = (globalThis as { console?: Partial<Record<'log' | 'warn', Log>> }).console;

/** The packages' debug and warning output: the host's console when it has one, else nowhere. Nothing depends on it. */
export const console = {
	log: (...args: unknown[]) => hostConsole?.log?.(...args),
	warn: (...args: unknown[]) => hostConsole?.warn?.(...args),
};
