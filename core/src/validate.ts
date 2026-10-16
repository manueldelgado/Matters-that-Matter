// A request checked against the boundary's JSON Schema before it reaches the operations, so a caller's mistake comes
// back as a `bad-request` naming the place, never as an exception. Covers the keywords the generated schemas use:
// type, const, enum, pattern, properties, required, additionalProperties, items (a schema or a tuple), minItems, maxItems,
// anyOf, not and local $ref. Pure.

export interface Schema {
	$ref?: string;
	type?: string | string[];
	const?: unknown;
	enum?: unknown[];
	pattern?: string;
	properties?: Record<string, Schema>;
	required?: string[];
	additionalProperties?: boolean | Schema;
	items?: Schema | Schema[];
	minItems?: number;
	maxItems?: number;
	anyOf?: Schema[];
	not?: Schema;
	definitions?: Record<string, Schema>;
}

/** Where the value doesn't fit, as a JSON Pointer (`/input/title`), and how. */
export interface Mismatch {
	at: string;
	message: string;
	/** For a value of the wrong type or constant: what would have fitted. */
	expected?: string[];
	/** A constant that didn't match: in a union, the sign of a branch not meant. */
	constant?: boolean;
}

const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

function fitsType(v: unknown, type: string): boolean {
	if (type === 'integer') return typeof v === 'number' && Number.isInteger(v);
	if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
	return typeOf(v) === type;
}

const pointer = (at: string, key: string | number) => `${at}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

export class Validator {
	constructor(private readonly root: Schema) {}

	/** The first place `value` doesn't fit the root schema, or null when it fits. */
	check(value: unknown): Mismatch | null {
		return this.at(this.root, value, '');
	}

	private resolve(schema: Schema): Schema {
		let s = schema;
		for (let hops = 0; s.$ref && hops < 32; hops++) {
			const name = /^#\/definitions\/(.+)$/.exec(s.$ref)?.[1];
			const target = name === undefined ? undefined : this.root.definitions?.[decodeURIComponent(name)];
			if (!target) throw new Error(`Unknown schema reference ${s.$ref}`);
			s = target;
		}
		return s;
	}

	private at(schema: Schema, v: unknown, at: string): Mismatch | null {
		const s = this.resolve(schema);
		if (s.anyOf) return this.anyOf(s.anyOf, v, at);
		if (s.not && this.at(s.not, v, at) === null) return { at, message: 'is not allowed here' };
		if (s.type !== undefined) {
			const types = Array.isArray(s.type) ? s.type : [s.type];
			if (!types.some((t) => fitsType(v, t))) return { at, message: `must be ${types.join(' or ')}, not ${typeOf(v)}`, expected: types };
		}
		if ('const' in s && v !== s.const) return { at, message: `must be ${JSON.stringify(s.const)}`, expected: [JSON.stringify(s.const)], constant: true };
		if (s.enum && !s.enum.includes(v)) return { at, message: `must be one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}` };
		if (s.pattern !== undefined && typeof v === 'string' && !new RegExp(s.pattern, 'u').test(v)) return { at, message: `must match ${s.pattern}` };
		if (Array.isArray(v)) return this.array(s, v, at);
		if (typeOf(v) === 'object') return this.object(s, v as Record<string, unknown>, at);
		return null;
	}

	/**
	 * The first branch that fits, else the most telling miss: a union told apart by a `const` (the request's `op`)
	 * reports the branch it names, deepest first; misses all at this place are reported together.
	 */
	private anyOf(branches: Schema[], v: unknown, at: string): Mismatch | null {
		const misses: Mismatch[] = [];
		for (const b of branches) {
			const miss = this.at(b, v, at);
			if (!miss) return null;
			misses.push(miss);
		}
		const telling = misses.filter((m) => !m.constant);
		const pool = telling.length ? telling : misses;
		const deepest = pool.reduce((a, b) => (b.at.length > a.at.length ? b : a));
		const here = pool.filter((m) => m.at === deepest.at);
		if (here.length > 1 && here.every((m) => m.expected)) {
			const expected = [...new Set(here.flatMap((m) => m.expected ?? []))];
			return { at: deepest.at, message: `must be ${expected.join(' or ')}`, expected };
		}
		return deepest;
	}

	private array(s: Schema, v: unknown[], at: string): Mismatch | null {
		if (s.minItems !== undefined && v.length < s.minItems) return { at, message: `needs at least ${s.minItems} items` };
		if (s.maxItems !== undefined && v.length > s.maxItems) return { at, message: `takes at most ${s.maxItems} items` };
		for (let i = 0; i < v.length; i++) {
			const item = Array.isArray(s.items) ? s.items[i] : s.items;
			if (!item) continue;
			const miss = this.at(item, v[i], pointer(at, i));
			if (miss) return miss;
		}
		return null;
	}

	private object(s: Schema, v: Record<string, unknown>, at: string): Mismatch | null {
		const has = (key: string) => Object.prototype.hasOwnProperty.call(v, key);
		// Constants first: in a union, a branch not meant fails on its discriminator before anything else.
		const constants = Object.entries(s.properties ?? {}).filter(([key, prop]) => has(key) && 'const' in this.resolve(prop));
		for (const [key, prop] of constants) {
			const miss = this.at(prop, v[key], pointer(at, key));
			if (miss) return miss;
		}
		for (const key of s.required ?? []) {
			if (!has(key)) return { at: pointer(at, key), message: 'is required' };
		}
		for (const [key, value] of Object.entries(v)) {
			const prop = s.properties?.[key];
			if (prop) {
				if (constants.some(([k]) => k === key)) continue;
				const miss = this.at(prop, value, pointer(at, key));
				if (miss) return miss;
			} else if (s.additionalProperties === false) {
				return { at: pointer(at, key), message: 'is not a known field' };
			} else if (typeof s.additionalProperties === 'object') {
				const miss = this.at(s.additionalProperties, value, pointer(at, key));
				if (miss) return miss;
			}
		}
		return null;
	}
}
