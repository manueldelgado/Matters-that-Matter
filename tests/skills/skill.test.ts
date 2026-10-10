// The skill for AI assistants (skills/matters-that-matter): its frontmatter follows the Agent Skills format, it names
// only tools the MCP server has, it keeps to the product's words, and the notes it shows as examples are valid.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';

const root = fileURLToPath(new URL('../..', import.meta.url));
const SKILL_DIR = 'skills/matters-that-matter';
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const skill = read(`${SKILL_DIR}/SKILL.md`);
const format = read(`${SKILL_DIR}/references/format.md`);
const openai = read(`${SKILL_DIR}/agents/openai.yaml`);

/** The MCP server's tools, by their public names. */
const MCP_TOOLS = [
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
];

type Json = Record<string, unknown>;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const schema = (name: string) => JSON.parse(read(`schema/${name}.json`)) as Json;
const validators: Record<'action' | 'matter' | 'settings', ValidateFunction> = {
	action: ajv.compile(schema('action')),
	matter: ajv.compile(schema('matter')),
	settings: ajv.compile(schema('settings')),
};

function errors(name: keyof typeof validators, value: unknown): string[] {
	const validate = validators[name];
	return validate(value) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`);
}

/** A Markdown file's frontmatter, parsed, and its body. */
function splitNote(text: string): { frontmatter: Json; body: string } {
	const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
	if (!m) throw new Error('no frontmatter');
	return { frontmatter: parse(m[1] ?? '') as Json, body: text.slice(m[0].length) };
}

/** The fenced code blocks of a Markdown text, with their language. */
function codeBlocks(text: string): { lang: string; code: string }[] {
	const out: { lang: string; code: string }[] = [];
	const re = /^( *)```(\w*)\n([\s\S]*?)\n\1```$/gm;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		const indent = m[1] ?? '';
		out.push({ lang: m[2] ?? '', code: (m[3] ?? '').replace(new RegExp(`^${indent}`, 'gm'), '') });
	}
	return out;
}

/** Prose only: fenced code blocks and inline code removed. */
const prose = (text: string) => text.replace(/^( *)```[\s\S]*?\n\1```$/gm, '').replace(/`[^`\n]*`/g, '');

/** The example notes of a Markdown text: Markdown code blocks that start with frontmatter. */
const exampleNotes = (text: string) =>
	codeBlocks(text)
		.filter((b) => b.lang === 'markdown' && b.code.startsWith('---\n'))
		.map((b) => splitNote(b.code).frontmatter);

describe('the skill', () => {
	const { frontmatter, body } = splitNote(skill);

	it('has Agent Skills frontmatter with a valid name and description', () => {
		expect(Object.keys(frontmatter).every((k) => ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'].includes(k))).toBe(true);
		const name = frontmatter.name as string;
		expect(name).toBe('matters-that-matter');
		expect(name.length).toBeLessThanOrEqual(64);
		expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
		expect(SKILL_DIR.endsWith(`/${name}`)).toBe(true);
		const description = frontmatter.description as string;
		expect(typeof description).toBe('string');
		expect(description.trim().length).toBeGreaterThan(0);
		expect(description.length).toBeLessThanOrEqual(1024);
		expect(description).not.toMatch(/[<>]/);
		expect(body.trim().length).toBeGreaterThan(0);
	});

	it('names only tools the MCP server has, and every one of them', () => {
		for (const text of [skill, format]) {
			const names = new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []);
			expect([...names].filter((n) => !MCP_TOOLS.includes(n))).toEqual([]);
		}
		expect(MCP_TOOLS.filter((t) => !skill.includes(`\`${t}\``))).toEqual([]);
	});

	it.each([
		['SKILL.md', skill],
		['references/format.md', format],
		['agents/openai.yaml', openai],
	])('%s keeps to the product’s words', (_file, text) => {
		const forbidden = /\b(?:tasks?|projects?|to-?dos?|contexts?|gtd)\b|getting things done/gi;
		expect(prose(text).match(forbidden) ?? []).toEqual([]);
	});

	it('shows an example Action that validates against the Action schema', () => {
		const notes = exampleNotes(skill);
		expect(notes.length).toBe(1);
		const action = notes[0];
		expect(action?.['mtm-kind']).toBe('action');
		// What every new Action carries, as the skill tells writers.
		for (const key of ['mtm-type', 'mtm-status', 'mtm-matter']) expect(action).toHaveProperty(key);
		expect(errors('action', action)).toEqual([]);
	});
});

describe('the format reference', () => {
	it('shows example notes that validate against their schemas', () => {
		const notes = exampleNotes(format);
		expect(notes.map((n) => n['mtm-kind'])).toEqual(['action', 'matter']);
		for (const note of notes) expect(errors(note['mtm-kind'] === 'action' ? 'action' : 'matter', note)).toEqual([]);
	});

	it('shows settings whose statuses, types and Spheres validate against the settings schema', () => {
		const block = codeBlocks(format).find((b) => b.lang === 'json');
		const example = JSON.parse(block?.code ?? '{}') as Json;
		expect(errors('settings', { ...DEFAULT_SETTINGS, ...example, linksAddActions: true })).toEqual([]);
	});

	it('links the public schemas and docs, and no private place', () => {
		for (const name of ['action', 'matter', 'settings']) {
			expect(format).toContain(`https://matters-that-matter.app/schema/v1/${name}.json`);
			expect(skill).toContain(`https://matters-that-matter.app/schema/v1/${name}.json`);
		}
		const urls = [...`${skill}\n${format}\n${openai}`.matchAll(/https?:\/\/[^\s)>"]+/g)].map((m) => m[0]);
		expect(urls.filter((u) => !u.startsWith('https://matters-that-matter.app/'))).toEqual([]);
	});
});

describe('the Codex metadata', () => {
	it('names the MCP server and keeps within Codex’s limits', () => {
		const meta = parse(openai) as {
			interface: { display_name: string; short_description: string; default_prompt?: string };
			dependencies: { tools: { type: string; value: string; description: string; transport: string }[] };
		};
		expect(meta.interface.display_name).toBe('Matters that Matter');
		expect(meta.interface.short_description.length).toBeGreaterThanOrEqual(25);
		expect(meta.interface.short_description.length).toBeLessThanOrEqual(64);
		expect(meta.interface.default_prompt).toContain('$matters-that-matter');
		const [server] = meta.dependencies.tools;
		expect(server).toMatchObject({ type: 'mcp', transport: 'stdio' });
		expect(server?.description).toContain('npx -y matters-that-matter mcp --vault');
		expect(server?.description.length).toBeLessThanOrEqual(1024);
	});
});
