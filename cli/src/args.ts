// Command-line arguments: the command, its words, and flags by their public names (`--waiting-on`, `--due`). A small
// parser with no dependency: `--flag value`, `--flag=value`, repeatable list flags, `--no-<field>` to remove a value,
// and `--` before words that start with a dash.

import { CLI } from './strings';

export type FlagKind = 'bool' | 'value' | 'list';

interface FlagSpec {
	kind: FlagKind;
	/** `--no-<name>` gives null (removes the value on update). */
	negatable?: boolean;
}

/** Every flag any command takes; each command accepts the global ones and its own (`COMMAND_FLAGS`). */
export const FLAGS: Record<string, FlagSpec> = {
	// Global.
	vault: { kind: 'value' },
	'config-dir': { kind: 'value' },
	json: { kind: 'bool' },
	'dry-run': { kind: 'bool' },
	help: { kind: 'bool' },
	version: { kind: 'bool' },
	// Hidden: a fixed clock for tests, and the plan of a write as JSON.
	now: { kind: 'value' },
	'plan-out': { kind: 'value' },
	// Action fields.
	title: { kind: 'value' },
	matter: { kind: 'value' },
	status: { kind: 'value' },
	type: { kind: 'value' },
	priority: { kind: 'value', negatable: true },
	start: { kind: 'value', negatable: true },
	due: { kind: 'value', negatable: true },
	'waiting-on': { kind: 'value', negatable: true },
	people: { kind: 'list', negatable: true },
	details: { kind: 'value' },
	checklist: { kind: 'list' },
	link: { kind: 'value' },
	// List filters.
	sphere: { kind: 'value' },
	person: { kind: 'value' },
	'due-from': { kind: 'value' },
	'due-to': { kind: 'value' },
	waiting: { kind: 'bool' },
	done: { kind: 'bool' },
	// Matter fields.
	icon: { kind: 'value' },
	state: { kind: 'value' },
	outcome: { kind: 'value' },
	'review-every': { kind: 'value' },
	// The MCP server.
	'read-only': { kind: 'bool' },
	tools: { kind: 'value' },
};

const SHORT: Record<string, string> = { h: 'help', V: 'version' };

export const GLOBAL_FLAGS = ['vault', 'config-dir', 'json', 'dry-run', 'help', 'version', 'now', 'plan-out'] as const;

const ACTION_FIELDS = ['title', 'matter', 'status', 'type', 'priority', 'start', 'due', 'waiting-on', 'people', 'details', 'checklist', 'link'];

export const COMMANDS = ['today', 'add', 'update', 'done', 'reopen', 'show', 'list', 'add-matter', 'matters', 'workflow', 'parse', 'open', 'mcp'] as const;
export type Command = (typeof COMMANDS)[number];

export const COMMAND_FLAGS: Record<Command, readonly string[]> = {
	today: [],
	add: ACTION_FIELDS,
	update: ACTION_FIELDS,
	done: [],
	reopen: [],
	show: [],
	list: ['matter', 'status', 'type', 'sphere', 'person', 'due-from', 'due-to', 'waiting', 'done'],
	'add-matter': ['icon', 'sphere', 'state', 'outcome', 'review-every'],
	matters: [],
	workflow: [],
	parse: [],
	open: [],
	mcp: ['read-only', 'tools'],
};

export type FlagValue = string | boolean | string[] | null;

export interface ParsedArgs {
	command: Command | null;
	/** The words after the command, in order. */
	words: string[];
	flags: Record<string, FlagValue>;
}

export type ArgsResult = { ok: true; args: ParsedArgs } | { ok: false; message: string };

const isCommand = (word: string): word is Command => (COMMANDS as readonly string[]).includes(word);

export function parseArgs(argv: readonly string[]): ArgsResult {
	const flags: Record<string, FlagValue> = {};
	const words: string[] = [];
	let command: Command | null = null;
	let unknownCommand: string | null = null;
	let rest = false;

	for (let i = 0; i < argv.length; i++) {
		const token = argv[i] ?? '';
		if (rest || token === '-' || !token.startsWith('-')) {
			if (command === null && unknownCommand === null && words.length === 0) {
				if (isCommand(token)) command = token;
				else unknownCommand = token;
				continue;
			}
			words.push(token);
			continue;
		}
		if (token === '--') {
			rest = true;
			continue;
		}

		let name: string;
		let inline: string | undefined;
		if (token.startsWith('--')) {
			const eq = token.indexOf('=');
			name = eq < 0 ? token.slice(2) : token.slice(2, eq);
			inline = eq < 0 ? undefined : token.slice(eq + 1);
		} else {
			const short = SHORT[token.slice(1)];
			if (!short) return { ok: false, message: CLI.unknownOption(token) };
			name = short;
		}

		const spec = FLAGS[name];
		if (!spec && name.startsWith('no-')) {
			const field = name.slice(3);
			const negated = FLAGS[field];
			if (negated?.negatable && inline === undefined) {
				flags[field] = null;
				continue;
			}
		}
		if (!spec) return { ok: false, message: CLI.unknownOption(`--${name}`) };

		if (spec.kind === 'bool') {
			if (inline !== undefined) return { ok: false, message: CLI.noValue(name) };
			flags[name] = true;
			continue;
		}
		let value = inline;
		if (value === undefined) {
			const next = argv[i + 1];
			if (next === undefined || next.startsWith('--')) return { ok: false, message: CLI.needsValue(name) };
			value = next;
			i++;
		}
		if (spec.kind === 'list') {
			const list = flags[name];
			flags[name] = [...(Array.isArray(list) ? list : []), value];
		} else flags[name] = value;
	}

	if (unknownCommand !== null) return { ok: false, message: CLI.unknownCommand(unknownCommand) };
	if (command) {
		const allowed = new Set<string>([...GLOBAL_FLAGS, ...COMMAND_FLAGS[command]]);
		for (const name of Object.keys(flags)) {
			if (!allowed.has(name)) return { ok: false, message: CLI.notForCommand(name, command) };
		}
	}
	return { ok: true, args: { command, words, flags } };
}

/** A value flag as text (undefined when not given; null when removed with `--no-…`). */
export function textFlag(flags: Record<string, FlagValue>, name: string): string | null | undefined {
	const v = flags[name];
	if (v === undefined || v === null) return v;
	if (Array.isArray(v)) return v[v.length - 1];
	return typeof v === 'string' ? v : undefined;
}

export function listFlag(flags: Record<string, FlagValue>, name: string): string[] | null | undefined {
	const v = flags[name];
	if (v === undefined || v === null) return v;
	return Array.isArray(v) ? v : typeof v === 'string' ? [v] : undefined;
}

export const boolFlag = (flags: Record<string, FlagValue>, name: string): boolean => flags[name] === true;
