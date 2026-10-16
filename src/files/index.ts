// The vault as Obsidian's metadata cache sees it, built from file contents alone: the file list, each note's
// properties, links, embeds and tasks, how links resolve and the link text Obsidian writes. Pure: the caller
// passes in how to list and read files.

import { readFrontmatter, stripBom, type Frontmatter } from './frontmatter';
import { bodyLinks, frontmatterLinks, linkpath, type FrontmatterLinkRef, type LinkRef } from './links';
import { fileToLinktext, linkFormat, type LinkFormat } from './linkText';
import { basenameOf, byCodeUnit, extensionOf, foldName, parentOf } from './paths';
import { LinkResolver } from './resolve';
import { scanBody, splitLines } from './scan';
import { taskLines, type TaskLine } from './tasks';

/** How the index reaches the files. Paths are vault paths: `/`-separated, relative to the vault root. */
export interface VaultReader {
	/** Every file under the vault (any extension, hidden folders included: the index leaves them out). */
	list(): Iterable<string>;
	/** A file's text (UTF-8); throws or returns null when there is no such file. */
	read(path: string): string | null;
}

export interface IndexOptions {
	/** The vault's configuration folder (Obsidian's default is a dot-folder in the vault root; the caller names it). */
	configDir: string;
}

/** The link settings in the configuration folder's `app.json`, with Obsidian's defaults. */
export interface LinkConfig {
	alwaysUpdateLinks: boolean;
	newLinkFormat: LinkFormat;
	useMarkdownLinks: boolean;
}

/** What the cache holds for the body of a note. */
export interface NoteBody {
	links: LinkRef[];
	embeds: LinkRef[];
	tasks: TaskLine[];
}

/** One note as the index holds it; the body is read on first use. */
export interface IndexedNote {
	path: string;
	/** The file name without `.md`. */
	basename: string;
	frontmatter: Frontmatter | null;
	/** The closing `---` line and the offset after it; null when there are no properties. */
	frontmatterEnd: { line: number; offset: number } | null;
	frontmatterLinks: FrontmatterLinkRef[];
	/** The first body line: after the properties block when there is one. */
	bodyLine: number;
}

/** A note the index couldn't read: it stays listed, with no properties and an empty body. */
export interface IndexWarning {
	path: string;
	message: string;
}

/** A path as macOS and Windows compare them (see `foldName`). */
const foldPath = foldName;

/** Whether Obsidian lists a file: not in the configuration folder, `.trash` or any folder or file starting with a dot. */
export function isVaultFile(path: string, configDir: string): boolean {
	if (path === '' || path === configDir || path.startsWith(`${configDir}/`)) return false;
	return !path.split('/').some((part) => part.startsWith('.') || part === '');
}

/** Reads the link settings from `app.json`; missing or unreadable settings take Obsidian's defaults. */
export function readLinkConfig(reader: Pick<VaultReader, 'read'>, configDir: string): LinkConfig {
	let raw: Record<string, unknown> = {};
	try {
		const text = reader.read(`${configDir}/app.json`);
		const parsed: unknown = text ? JSON.parse(text) : null;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
	} catch {
		raw = {};
	}
	return {
		alwaysUpdateLinks: raw.alwaysUpdateLinks === true,
		newLinkFormat: linkFormat(raw.newLinkFormat),
		useMarkdownLinks: raw.useMarkdownLinks === true,
	};
}

export class VaultIndex {
	/** Every file Obsidian lists, in code-unit order. */
	readonly files: readonly string[];
	/** Every Markdown note, in code-unit order. */
	readonly notePaths: readonly string[];
	readonly config: LinkConfig;
	/** Notes that couldn't be read, in code-unit order. */
	readonly warnings: IndexWarning[] = [];
	private readonly resolver: LinkResolver;
	private readonly notes = new Map<string, IndexedNote>();
	private readonly contents = new Map<string, string>();
	private readonly bodies = new Map<string, NoteBody>();
	private readonly counts = new Map<string, { resolved: Record<string, number>; unresolved: Record<string, number> }>();
	private readonly lowerPaths = new Set<string>();

	constructor(reader: VaultReader, options: IndexOptions) {
		const { configDir } = options;
		this.config = readLinkConfig(reader, configDir);
		this.files = [...new Set(reader.list())].filter((path) => isVaultFile(path, configDir)).sort(byCodeUnit);
		this.notePaths = this.files.filter((path) => extensionOf(path) === 'md');
		this.resolver = new LinkResolver(this.files);
		for (const path of this.files) {
			for (let folder = path; folder !== ''; folder = parentOf(folder)) this.lowerPaths.add(foldPath(folder));
		}
		for (const path of this.notePaths) {
			const content = this.readText(reader, path);
			this.contents.set(path, content);
			const info = readFrontmatter(content);
			this.notes.set(path, {
				path,
				basename: basenameOf(path),
				frontmatter: info.frontmatter,
				frontmatterEnd: info.end,
				frontmatterLinks: frontmatterLinks(info.frontmatter),
				bodyLine: info.bodyLine,
			});
		}
	}

	/** The note at this path, or null. */
	note(path: string): IndexedNote | null {
		return this.notes.get(path) ?? null;
	}

	/** A note's whole text as read (a byte-order mark kept, for writing back), or null when there is no such note. */
	content(path: string): string | null {
		return this.contents.get(path) ?? null;
	}

	/** A note's body links, embeds and tasks (parsed once, on first use); null when there is no such note. */
	body(path: string): NoteBody | null {
		const cached = this.bodies.get(path);
		if (cached) return cached;
		const content = this.contents.get(path);
		const note = this.notes.get(path);
		if (content === undefined || !note) return null;
		const scanned = scanBody(splitLines(stripBom(content)), note.bodyLine);
		const body = { ...bodyLinks(scanned), tasks: taskLines(scanned) };
		this.bodies.set(path, body);
		return body;
	}

	/** Whether a file or folder uses this path, ignoring case and Unicode form (as macOS and Windows do). */
	existsIgnoringCase(path: string): boolean {
		return this.lowerPaths.has(foldPath(path));
	}

	/** Whether a file is at exactly this path. */
	has(path: string): boolean {
		return this.resolver.has(path);
	}

	/** The file a link (with or without `#heading`) reaches from a note, or null. */
	resolve(link: string, fromPath: string): string | null {
		return this.resolver.resolve(linkpath(link), fromPath);
	}

	/** The link text Obsidian writes from `fromPath` to `path`, in the vault's link format unless one is given. */
	linkText(path: string, fromPath: string, format: LinkFormat = this.config.newLinkFormat): string {
		return fileToLinktext(path, fromPath, format, (name) => this.resolver.nameCount(name));
	}

	/** Every link of a note (body, embeds and properties) counted by the file it reaches, as `resolvedLinks`. */
	resolvedLinks(path: string): Record<string, number> {
		return this.countLinks(path).resolved;
	}

	/** A note's links that reach no file, counted by link path (`.md` left out), as `unresolvedLinks`. */
	unresolvedLinks(path: string): Record<string, number> {
		return this.countLinks(path).unresolved;
	}

	private countLinks(path: string): { resolved: Record<string, number>; unresolved: Record<string, number> } {
		const known = this.counts.get(path);
		if (known) return { resolved: { ...known.resolved }, unresolved: { ...known.unresolved } };
		const resolved: Record<string, number> = {};
		const unresolved: Record<string, number> = {};
		const note = this.notes.get(path);
		const body = this.body(path);
		if (!note || !body) return { resolved, unresolved };
		for (const ref of [...body.links, ...body.embeds, ...note.frontmatterLinks]) {
			const target = linkpath(ref.link);
			const dest = this.resolver.resolve(target, path);
			if (dest !== null) resolved[dest] = (resolved[dest] ?? 0) + 1;
			else {
				const key = target.replace(/\.md$/, '');
				unresolved[key] = (unresolved[key] ?? 0) + 1;
			}
		}
		this.counts.set(path, { resolved, unresolved });
		return { resolved: { ...resolved }, unresolved: { ...unresolved } };
	}

	/** A note's text; when it can't be read, an empty text and a warning. */
	private readText(reader: VaultReader, path: string): string {
		try {
			const text = reader.read(path);
			if (text !== null) return text;
			this.warnings.push({ path, message: 'The file could not be read.' });
		} catch (error) {
			this.warnings.push({ path, message: error instanceof Error ? error.message : String(error) });
		}
		return '';
	}
}
