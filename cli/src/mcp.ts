// `mtm mcp`: Matters as an MCP server over stdio, for AI assistants. Ten tools over the same operations as the
// command line; each call reads the vault afresh, and writes go through the same all-or-nothing writer. No network
// listener, only Matters data out (an Action's details, checklist and the names of linked notes, never other notes'
// content), nothing deleted, settings never written.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { toYmd } from '../../src/model/dates';
import { addAction, addMatter, getAction, getWorkflow, inputKey, listActions, listMatters, markAsDone, reopen, today, updateAction } from '../../src/ops';
import type { ActionWrite, MatterSummary, OpError, OpResult, Snapshot, Warning } from '../../src/ops/types';
import { STRINGS } from '../../src/strings';
import type { ApplyFs } from './apply';
import type { ContentsAfter } from './filesLayer';
import { writeJson, type ErrorJson } from './json';
import { formatActionWrite, formatError, formatList, formatMatterAdded, formatMatters, formatShow, formatToday, formatWorkflow, shownPath, style, typeTones } from './output';
import { CLI, MCP } from './strings';
import { PACKAGE_NAME, VERSION } from './version';
import { openVault, type Vault } from './vault';
import { planAndWrite, takeSnapshot, type ReaderFactory, type WriteFlow } from './writeFlow';

// ——— The tools ———

export const TOOL_NAMES = [
	'add_action',
	'update_action',
	'mark_as_done',
	'reopen_action',
	'get_action',
	'list_actions',
	'get_today',
	'add_matter',
	'list_matters',
	'get_workflow',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** The tools `--read-only` offers. */
export const READ_TOOLS: readonly ToolName[] = ['get_action', 'list_actions', 'get_today', 'list_matters', 'get_workflow'];

const isToolName = (name: string): name is ToolName => (TOOL_NAMES as readonly string[]).includes(name);

/** Which tools `--read-only` and `--tools a,b` leave; a message for an exit code 2 when they can't be read. */
export function chooseTools(readOnly: boolean, toolsFlag: string | null | undefined): { ok: true; tools: ToolName[] } | { ok: false; message: string } {
	let tools: ToolName[] = readOnly ? [...READ_TOOLS] : [...TOOL_NAMES];
	if (typeof toolsFlag === 'string') {
		const names = toolsFlag
			.split(',')
			.map((n) => n.trim())
			.filter(Boolean);
		if (!names.length) return { ok: false, message: MCP.noTools(TOOL_NAMES) };
		const unknown = names.filter((n) => !isToolName(n));
		if (unknown.length) return { ok: false, message: MCP.unknownTools(unknown, TOOL_NAMES) };
		const writes = names.filter((n) => readOnly && !READ_TOOLS.includes(n as ToolName));
		if (writes.length) return { ok: false, message: MCP.writesWhenReadOnly(writes, READ_TOOLS) };
		tools = TOOL_NAMES.filter((n) => names.includes(n));
	}
	return { ok: true, tools };
}

// ——— Fields ———

type Kind = 'text' | 'nullableText' | 'list' | 'nullableList' | 'bool' | 'priority' | 'nullablePriority';

interface Field {
	/** The public name (`waiting-on`); the operations' key comes from it. */
	name: string;
	kind: Kind;
	description: string;
	required?: boolean;
	enum?: readonly string[];
}

type JsonSchema = Record<string, unknown>;

const F = MCP.fields;
const PRIORITIES = [1, 2, 3, 'high', 'medium', 'low'] as const;

function fieldSchema(f: Field): JsonSchema {
	const base = { description: f.description };
	switch (f.kind) {
		case 'text':
			return { type: 'string', ...(f.enum ? { enum: f.enum } : {}), ...base };
		case 'nullableText':
			return { anyOf: [{ type: 'string' }, { type: 'null' }], ...base };
		case 'list':
			return { type: 'array', items: { type: 'string' }, ...base };
		case 'nullableList':
			return { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }], ...base };
		case 'bool':
			return { type: 'boolean', ...base };
		case 'priority':
			return { enum: [...PRIORITIES], ...base };
		case 'nullablePriority':
			return { enum: [...PRIORITIES, null], ...base };
	}
}

const actionRef: Field = { name: 'action', kind: 'text', required: true, description: F.action };

function actionFields(update: boolean): Field[] {
	return [
		{ name: 'title', kind: 'text', description: update ? F.titleUpdate : F.title },
		{ name: 'matter', kind: 'text', description: F.matter },
		{ name: 'status', kind: 'text', description: F.status },
		{ name: 'type', kind: 'text', description: F.type },
		{ name: 'priority', kind: update ? 'nullablePriority' : 'priority', description: update ? F.priorityUpdate : F.priority },
		{ name: 'start', kind: update ? 'nullableText' : 'text', description: update ? F.dateUpdate : F.date },
		{ name: 'due', kind: update ? 'nullableText' : 'text', description: update ? F.dateUpdate : F.date },
		{ name: 'waiting-on', kind: update ? 'nullableText' : 'text', description: update ? F.waitingOnUpdate : F.waitingOn },
		{ name: 'people', kind: update ? 'nullableList' : 'list', description: update ? F.peopleUpdate : F.people },
		{ name: 'details', kind: 'text', description: F.details },
		{ name: 'checklist', kind: 'list', description: update ? F.checklistUpdate : F.checklist },
		{ name: 'link', kind: 'text', description: F.link },
	];
}

const FIELDS: Record<ToolName, Field[]> = {
	add_action: [{ name: 'text', kind: 'text', description: F.text }, ...actionFields(false)],
	update_action: [actionRef, ...actionFields(true)],
	mark_as_done: [actionRef],
	reopen_action: [actionRef],
	get_action: [actionRef],
	list_actions: [
		{ name: 'matter', kind: 'text', description: F.listMatter },
		{ name: 'status', kind: 'text', description: F.listStatus },
		{ name: 'type', kind: 'text', description: F.listType },
		{ name: 'sphere', kind: 'text', description: F.sphere },
		{ name: 'person', kind: 'text', description: F.person },
		{ name: 'due-from', kind: 'text', description: F.dueFrom },
		{ name: 'due-to', kind: 'text', description: F.dueTo },
		{ name: 'waiting', kind: 'bool', description: F.waiting },
		{ name: 'done', kind: 'bool', description: F.done },
	],
	get_today: [],
	add_matter: [
		{ name: 'name', kind: 'text', required: true, description: F.name },
		{ name: 'icon', kind: 'text', description: F.icon },
		{ name: 'sphere', kind: 'text', description: F.matterSphere },
		{ name: 'state', kind: 'text', enum: ['active', 'dormant', 'closed'], description: F.state },
		{ name: 'outcome', kind: 'text', description: F.outcome },
		{ name: 'review-every', kind: 'text', description: F.reviewEvery },
	],
	list_matters: [],
	get_workflow: [],
};

function inputSchema(tool: ToolName): Tool['inputSchema'] {
	const fields = FIELDS[tool];
	const required = fields.filter((f) => f.required).map((f) => f.name);
	return {
		type: 'object',
		properties: Object.fromEntries(fields.map((f) => [f.name, fieldSchema(f)])),
		...(required.length ? { required } : {}),
		additionalProperties: false,
	};
}

/** The arguments as the operations take them (camelCase keys), or why they can't be read. */
function readArguments(tool: ToolName, args: unknown): { ok: true; input: Record<string, unknown> } | { ok: false; error: OpError } {
	const invalid = (message: string, field?: string): { ok: false; error: OpError } => ({ ok: false, error: { code: 'invalid', ...(field ? { field } : {}), message } });
	if (args === undefined || args === null) args = {};
	if (typeof args !== 'object' || Array.isArray(args)) return invalid(MCP.notAnObject);
	const given = args as Record<string, unknown>;
	const fields = FIELDS[tool];
	for (const key of Object.keys(given)) {
		if (!fields.some((f) => f.name === key)) return invalid(MCP.unknownField(tool, key, fields.map((f) => f.name)), key);
	}
	const input: Record<string, unknown> = {};
	for (const f of fields) {
		const v = given[f.name];
		if (v === undefined) {
			if (f.required) return invalid(MCP.needs(tool, f.name), f.name);
			continue;
		}
		const isList = Array.isArray(v) && v.every((x) => typeof x === 'string');
		const ok =
			f.kind === 'text'
				? typeof v === 'string'
				: f.kind === 'nullableText'
					? typeof v === 'string' || v === null
					: f.kind === 'list'
						? isList
						: f.kind === 'nullableList'
							? isList || v === null
							: f.kind === 'bool'
								? typeof v === 'boolean'
								: typeof v === 'number' || typeof v === 'string' || (f.kind === 'nullablePriority' && v === null);
		if (!ok) {
			// null only removes what can be removed (on update_action); elsewhere it's refused, never ignored.
			if (v === null) return invalid(f.required ? MCP.needs(tool, f.name) : MCP.takesNoNull(f.name), f.name);
			const message =
				f.kind === 'text'
					? MCP.takesText(f.name)
					: f.kind === 'nullableText'
						? MCP.takesTextOrNull(f.name)
						: f.kind === 'list' || f.kind === 'nullableList'
							? MCP.takesList(f.name)
							: f.kind === 'bool'
								? MCP.takesBool(f.name)
								: MCP.takesPriority(f.name, f.kind === 'nullablePriority');
			return invalid(message, f.name);
		}
		if (f.required && typeof v === 'string' && !v.trim()) return invalid(MCP.needs(tool, f.name), f.name);
		// null removes the people, as an empty list does.
		input[inputKey(f.name)] = f.kind === 'nullableList' && v === null ? [] : v;
	}
	return { ok: true, input };
}

// ——— What tools return ———

// Nullable values are `anyOf` a type and null (not a list of types), which more hosts read.
const str = { type: 'string' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const orNull = (schema: JsonSchema) => ({ anyOf: [schema, { type: 'null' }] });
const strOrNull = orNull(str);
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)): JsonSchema => ({ type: 'object', properties, required });
const arr = (items: unknown) => ({ type: 'array', items });
const idLabel = obj({ id: str, label: str });
const noteRef = obj({ path: strOrNull, name: str });

const ACTION = obj({
	path: str,
	title: str,
	matter: obj({ path: str, name: str, isInbox: bool }),
	status: obj({ id: str, label: str, category: { enum: ['open', 'active', 'closed'] } }),
	type: idLabel,
	priority: orNull(int),
	start: strOrNull,
	due: strOrNull,
	today: bool,
	overdue: bool,
	waitingOn: orNull(noteRef),
	waitingSince: strOrNull,
	completed: strOrNull,
	orphans: arr(obj({ field: { enum: ['status', 'type', 'matter'] }, raw: str })),
	raw: { type: 'object' },
});

const ACTION_DETAIL: JsonSchema = {
	...ACTION,
	properties: {
		...(ACTION.properties as Record<string, unknown>),
		details: str,
		checklist: arr(obj({ text: str, checked: bool })),
		linkedNotes: arr(noteRef),
		people: arr(noteRef),
		startsAfterDue: bool,
	},
	required: [...(ACTION.required as string[]), 'details', 'checklist', 'linkedNotes', 'people', 'startsAfterDue'],
};

const MATTER = obj({
	path: str,
	name: str,
	icon: str,
	isInbox: bool,
	state: { enum: ['active', 'dormant', 'closed'] },
	sphere: orNull(idLabel),
	sphereOrphan: strOrNull,
	outcome: strOrNull,
	laneOrder: orNull({ type: 'number' }),
	review: orNull(obj({ every: str, lastReviewed: strOrNull, nextDue: strOrNull, due: bool, daysSince: orNull(int) })),
	counts: obj({ open: int, today: int, waiting: int, closed: int, total: int }),
	noNextAction: bool,
});

const WARNING = obj({ code: str, field: str, value: str, message: str }, ['code', 'message']);

/** What a write returns; `entity` is `action` or `matter`. */
const WRITE = (entity: 'action' | 'matter', schema: JsonSchema): JsonSchema =>
	obj({
		[entity]: schema,
		changed: bool,
		dryRun: bool,
		written: bool,
		changes: arr({ type: 'object', properties: { kind: { enum: ['create', 'rename', 'property', 'details', 'checklist', 'link'] } }, required: ['kind'] }),
		warnings: arr(WARNING),
		links: arr(obj({ path: str, lines: arr(int) })),
		danglingLinks: int,
	});

const OUTPUT: Record<ToolName, JsonSchema> = {
	add_action: WRITE('action', ACTION),
	update_action: WRITE('action', ACTION),
	mark_as_done: WRITE('action', ACTION),
	reopen_action: WRITE('action', ACTION),
	get_action: ACTION_DETAIL,
	list_actions: obj({ actions: arr(ACTION) }),
	get_today: obj({
		date: str,
		due: arr(ACTION),
		dueToday: int,
		late: int,
		nextStatus: orNull(idLabel),
		next: arr(ACTION),
		inbox: int,
		reviews: arr(MATTER),
		waiting: arr(ACTION),
		longWaits: int,
	}),
	add_matter: WRITE('matter', MATTER),
	list_matters: obj({ matters: arr(MATTER) }),
	get_workflow: obj({
		statuses: arr(obj({ id: str, label: str, category: { enum: ['open', 'active', 'closed'] }, tone: str, backlog: bool, done: bool })),
		types: arr(obj({ id: str, label: str, icon: str, tone: str, default: bool })),
		spheres: arr(obj({ id: str, label: str, icon: str })),
	}),
};

const WRITES: readonly ToolName[] = ['add_action', 'update_action', 'mark_as_done', 'reopen_action', 'add_matter'];
const IDEMPOTENT: readonly ToolName[] = ['mark_as_done', 'reopen_action'];

/** A tool as `tools/list` gives it. */
export function toolDefinition(name: ToolName): Tool {
	const text = MCP.tools[name];
	const writes = WRITES.includes(name);
	return {
		name,
		title: text.title,
		description: text.description,
		inputSchema: inputSchema(name),
		outputSchema: OUTPUT[name] as Tool['outputSchema'],
		annotations: {
			title: text.title,
			readOnlyHint: !writes,
			...(writes ? { destructiveHint: false, idempotentHint: IDEMPOTENT.includes(name) } : {}),
			openWorldHint: false,
		},
	};
}

// ——— Calls ———

export interface McpConfig {
	/** The vault as given (`--vault` or MTM_VAULT), read afresh for every call. */
	vault: string;
	configDir?: string;
	cwd: string;
	home: string;
	tools: readonly ToolName[];
	dryRun: boolean;
	/** A fixed time (`--now`); otherwise the clock at each call. */
	now: Date | null;
	clock?: () => Date;
	reader?: ReaderFactory;
	contentsAfter?: ContentsAfter;
	fs?: ApplyFs;
}

const plain = style(false);
const textResult = (lines: readonly string[]) => lines.join('\n');

function toolError(lines: readonly string[]): CallToolResult {
	return { isError: true, content: [{ type: 'text', text: textResult(lines) }] };
}

/** Where the assistant can find the names that would work. */
function pointer(field: string | undefined, code: string): string | null {
	if (field === 'action' && code === 'not-found') return MCP.findActions;
	if (field === 'matter' && code === 'unmatched') return MCP.findMatters;
	return null;
}

function opError(e: OpError, write: boolean): CallToolResult {
	const hint = pointer(e.field, e.code);
	return toolError([...formatError(e, write, plain), ...(hint ? [hint] : [])]);
}

/** After the answer: a pointer for a Matter that matched nothing (adding falls back to the Inbox). */
const warningPointers = (warnings: readonly Warning[]) => (warnings.some((w) => w.code === 'unmatched-matter') ? [MCP.findMatters] : []);
const writeError = (e: ErrorJson['error']) => toolError([e.message]);

/** Notes about the vault as a whole (setup not done, settings from a newer version), said before the answer. */
function vaultNotes(vault: Vault, warnings: readonly Warning[], read: boolean): string[] {
	const notes = warnings.filter((w) => w.code === 'newer-settings').map((w) => w.message);
	if (read && !vault.settings.setupDone) notes.unshift(STRINGS.ops.notSetUp);
	return notes.length ? [...notes, ''] : [];
}

/** A read: the human output as text, the `--json` value as structured content (lists inside an object). */
function read<T>(vault: Vault, now: Date, config: McpConfig, op: (s: Snapshot) => OpResult<T>, human: (value: T, s: Snapshot) => string[], wrap?: string): CallToolResult {
	const { snap } = takeSnapshot(vault, now, config.reader);
	const r = op(snap);
	if (!r.ok) return opError(r.error, false);
	return {
		content: [{ type: 'text', text: textResult([...vaultNotes(vault, r.warnings, true), ...human(r.value, snap)]) }],
		structuredContent: (wrap ? { [wrap]: r.value } : r.value) as Record<string, unknown>,
	};
}

function writeSource(vault: Vault, now: Date, config: McpConfig) {
	return { vault, now, dryRun: config.dryRun, reader: config.reader, contentsAfter: config.contentsAfter, fs: config.fs };
}

function failed<T>(w: Exclude<WriteFlow<T>, { ok: true }>): CallToolResult {
	return w.kind === 'op' ? opError(w.error, true) : writeError(w.error);
}

/** Add, update, done, reopen: `verb` is null for add. */
function writeAction(vault: Vault, now: Date, config: McpConfig, op: (s: Snapshot) => OpResult<ActionWrite>, verb: string | null): CallToolResult {
	const w = planAndWrite(writeSource(vault, now, config), op);
	if (!w.ok) return failed(w);
	const { r, snap, outcome, written } = w;
	const lines = [...formatActionWrite(verb, r, outcome, toYmd(snap.now), config.dryRun, plain), ...warningPointers(r.warnings)];
	return {
		content: [{ type: 'text', text: textResult([...vaultNotes(vault, r.warnings, false), ...lines]) }],
		structuredContent: writeJson({ action: r.value.action }, r, outcome, config.dryRun, written) as unknown as Record<string, unknown>,
	};
}

function writeMatter(vault: Vault, now: Date, config: McpConfig, input: Record<string, unknown>): CallToolResult {
	const w = planAndWrite<MatterSummary>(writeSource(vault, now, config), (s) => addMatter(input as unknown as Parameters<typeof addMatter>[0], s));
	if (!w.ok) return failed(w);
	const { r, outcome, written } = w;
	return {
		content: [{ type: 'text', text: textResult([...vaultNotes(vault, r.warnings, false), ...formatMatterAdded(r.value, r.warnings, config.dryRun, plain)]) }],
		structuredContent: writeJson({ matter: r.value }, r, outcome, config.dryRun, written) as unknown as Record<string, unknown>,
	};
}

/** Runs one tool call on the vault as it is now. User mistakes are tool errors, never protocol errors. */
export function callTool(config: McpConfig, name: ToolName, args: unknown): CallToolResult {
	const opened = openVault(config.vault, config.configDir, config.cwd, config.home);
	if (!opened.ok) return toolError([opened.message]);
	const vault = opened.vault;
	const now = config.now ?? config.clock?.() ?? new Date();
	const parsed = readArguments(name, args);
	if (!parsed.ok) return opError(parsed.error, WRITES.includes(name));
	const input = parsed.input;
	const ref = typeof input.action === 'string' ? input.action.trim() : '';
	switch (name) {
		case 'get_today':
			return read(vault, now, config, today, (v, s) => formatToday(v, shownPath(vault.root, config.home), typeTones(s), plain));
		case 'get_workflow':
			return read(vault, now, config, getWorkflow, (v) => formatWorkflow(v, plain));
		case 'list_matters':
			return read(vault, now, config, listMatters, (v) => formatMatters(v, plain), 'matters');
		case 'list_actions':
			return read(vault, now, config, (s) => listActions(input, s), (v, s) => formatList(v, toYmd(s.now), typeTones(s), plain), 'actions');
		case 'get_action':
			return read(vault, now, config, (s) => getAction(ref, s), (v, s) => formatShow(v, toYmd(s.now), plain));
		case 'add_action':
			return writeAction(vault, now, config, (s) => addAction(input, s), null);
		case 'update_action':
			return writeAction(vault, now, config, (s) => updateAction({ ...input, action: ref }, s), CLI.changed);
		case 'mark_as_done':
			return writeAction(vault, now, config, (s) => markAsDone(ref, s), CLI.markedDone);
		case 'reopen_action':
			return writeAction(vault, now, config, (s) => reopen(ref, s), CLI.reopened);
		case 'add_matter':
			return writeMatter(vault, now, config, input);
	}
}

// ——— The server ———

/**
 * The server with the tools `config.tools` names; connect it to a transport to serve. The SDK's low-level server:
 * the tools are declared with plain JSON Schemas, so its higher-level one (and its schema conversion) isn't needed.
 */
export function createMcpServer(config: McpConfig): Server {
	const server = new Server({ name: PACKAGE_NAME, title: 'Matters that Matter', version: VERSION }, { capabilities: { tools: {} }, instructions: MCP.instructions });
	const offered = TOOL_NAMES.filter((n) => config.tools.includes(n));
	server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: offered.map(toolDefinition) }));
	server.setRequestHandler(CallToolRequestSchema, (request) => {
		const { name, arguments: args } = request.params;
		if (!isToolName(name) || !offered.includes(name)) throw new McpError(ErrorCode.InvalidParams, MCP.unknownTool(name));
		try {
			return callTool(config, name, args);
		} catch (e) {
			// Something unexpected (a bug, a file that can't be read): said as a tool error, so the assistant can tell the user.
			return toolError([e instanceof Error ? e.message : String(e)]);
		}
	});
	return server;
}

/**
 * Serves until the transport closes: stdio unless a transport is given (tests use an in-memory one). Resolves with
 * the exit code.
 */
export async function serveMcp(config: McpConfig, transport?: Transport): Promise<number> {
	const server = createMcpServer(config);
	const closed = new Promise<number>((resolve) => {
		server.onclose = () => resolve(0);
	});
	if (transport) await server.connect(transport);
	else {
		await server.connect(new StdioServerTransport());
		// The host ends the session by closing standard input.
		process.stdin.once('end', () => void server.close());
	}
	return closed;
}
