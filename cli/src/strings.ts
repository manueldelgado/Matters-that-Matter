// What the command line says (British English, the plugin's voice). Words the plugin shows too come from its
// STRINGS (dates, card labels, the operations' messages); these are the command line's own.

import { VERSION, PACKAGE_NAME } from './version';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The help, as `mtm --help` prints it; `<b>…</b>` marks bold and `<d>…</d>` dim (plain without colour). */
export const HELP = `Matters that Matter, from the command line.            <d>${PACKAGE_NAME} ${VERSION}</d>

  <b>mtm today</b>                    What matters today?
  <b>mtm add</b> <text> [fields]      Add an Action (quick add’s words work)
  <b>mtm update</b> <action> [fields] Change an Action
  <b>mtm done</b> <action>            Mark as done
  <b>mtm reopen</b> <action>          Reopen a done Action
  <b>mtm show</b> <action>            Everything about one Action
  <b>mtm list</b> [filters]           Actions, done hidden
  <b>mtm add-matter</b> <name>        New Matter
  <b>mtm matters</b>                  Matters in board order
  <b>mtm workflow</b>                 Statuses, types and Spheres
  <b>mtm parse</b> <text>             What quick add would make of it
  <b>mtm open</b> <action|matter>     Open it in Obsidian
  <b>mtm mcp</b>                      Run as an MCP server (stdio)

  --vault <path>   the vault (or MTM_VAULT)      --json      for scripts
  --dry-run        show what would change       --help      this`;

const ACTION_FIELDS = `  --title <text>        the title (renames the note on update)
  --matter <name>       a Matter, by name, path or link text
  --status <status>     a status, by label or ID
  --type <type>         an Action type, by label or ID
  --priority <p>        1, 2 or 3, or high, medium or low
  --start <date>        2026-10-16, 2026-10-16T10:00 or words such as "fri 10:00"
  --due <date>          the same forms as --start
  --waiting-on <name>   a person (a note); also added to the people
  --people <name>       a person (a note); repeat for more
  --details <text>      the details
  --checklist <item>    a checklist item; repeat for more
  --link <note|url>     a note in the vault or a web address, added as a line`;

/** Help for one command: `mtm <command> --help`. */
export const COMMAND_HELP: Record<string, string> = {
	today: `<b>mtm today</b>
What matters today: Actions due today or late (else the next ones), the Inbox, reviews due and long waits.`,
	add: `<b>mtm add</b> <text> [fields]
Adds an Action. The text works as in quick add: /type, #Matter, @person, !1, and dates in words.
Fields given separately win over the text. Names that match nothing fall back as quick add does, and say so.

${ACTION_FIELDS}`,
	update: `<b>mtm update</b> <action> [fields]
Changes an Action, named by its path or its title. Values that match nothing are refused, and nothing is written.
--people replaces the people; --checklist adds items. Remove a value with --no-priority, --no-start, --no-due,
--no-waiting-on or --no-people.

${ACTION_FIELDS}`,
	done: `<b>mtm done</b> <action>
Marks an Action as done (its path or its title). Today becomes its completion date.`,
	reopen: `<b>mtm reopen</b> <action>
Reopens a done Action: it goes back to the backlog status.`,
	show: `<b>mtm show</b> <action>
Everything about one Action: its values, details, checklist, people and the names of linked notes.`,
	list: `<b>mtm list</b> [filters]
Actions grouped by Matter in board order. Done Actions are hidden unless you ask for them.

  --matter <name>       in this Matter
  --status <status>     in this status (a done status shows done Actions)
  --type <type>         of this type
  --sphere <sphere>     in Matters of this Sphere
  --person <name>       with this person, or waiting on them
  --due-from <date>     due on or after this day
  --due-to <date>       due on or before this day
  --waiting             only Actions waiting on someone
  --done                done Actions too`,
	'add-matter': `<b>mtm add-matter</b> <name> [fields]
Adds a Matter, last on the board.

  --icon <name>         a Lucide icon name, such as house
  --sphere <sphere>     a Sphere, by label or ID
  --state <state>       active (the default), dormant or closed
  --outcome <text>      what done looks like, in one line
  --review-every <n>    a review rhythm: 7d, 2w or 1m`,
	matters: `<b>mtm matters</b>
Every Matter in board order, with its Sphere, state, counts and review.`,
	workflow: `<b>mtm workflow</b>
The statuses, Action types and Spheres, with the IDs notes store.`,
	parse: `<b>mtm parse</b> <text>
What quick add would make of the text. Nothing is written.`,
	open: `<b>mtm open</b> <action|matter>
Opens an Action or a Matter in Obsidian, through a link Matters handles (a version of Matters with links).`,
	mcp: `<b>mtm mcp</b>
Runs as an MCP server over stdio, for AI assistants.

  --read-only           only the tools that read
  --tools <a,b>         only these tools`,
};

export const CLI = {
	version: `${PACKAGE_NAME} ${VERSION}`,

	// Arguments.
	unknownOption: (flag: string) => `There’s no option ${flag}. See mtm --help.`,
	unknownCommand: (word: string) => `There’s no command “${word}”. See mtm --help.`,
	noValue: (flag: string) => `--${flag} takes no value.`,
	needsValue: (flag: string) => `--${flag} needs a value.`,
	notForCommand: (flag: string, command: string) => `mtm ${command} doesn’t take --${flag}. See mtm ${command} --help.`,
	badNow: (value: string) => `“${value}” isn’t a time. Use 2026-10-09 or 2026-10-09T12:00.`,
	nameAction: 'Name the Action: its path or its title.',
	nameMatter: 'Name the Matter: its name or its path.',
	nameNew: 'Give the new Matter a name.',
	noParseText: 'Give the text to read.',

	// The vault isn't ready.
	noVault: 'Name the vault with --vault <path>, or set MTM_VAULT.',
	badConfigDir: (dir: string) => `--config-dir names one folder in the vault, such as .obsidian; “${dir}” isn’t one.`,
	noFolder: (path: string) => `There’s no folder at ${path}.`,
	notAVault: (path: string, configDir: string) => `${path} isn’t an Obsidian vault: it has no ${configDir} folder.`,
	noSettings: (path: string, file: string) => `Matters isn’t installed in ${path}: there’s no ${file}. Install Matters and run setup in Obsidian first.`,
	badSettings: (file: string) => `Matters’ settings in ${file} can’t be read. Open the vault in Obsidian to repair them.`,
	mcpLater: 'The MCP server isn’t in this version of mtm yet.',

	// Writing.
	nothingChanged: 'Nothing was changed.',
	changedMeanwhile: (path: string) => `${path} changed while Matters was about to write it, twice. Nothing was written; try again.`,
	writeFailed: (path: string, error: string) => `Writing ${path} failed (${error}). Everything was put back as it was; nothing was changed.`,
	writeFailedLeft: (path: string, error: string, left: readonly string[]) =>
		`Writing ${path} failed (${error}), and these files couldn’t be put back as they were: ${left.join(', ')}. Check them in Obsidian.`,
	exists: (path: string) => `${path} is there already (the vault changed while Matters was reading it). Nothing was written; try again.`,
	missing: (path: string) => `${path} isn’t there any more (the vault changed while Matters was reading it). Nothing was written; try again.`,
	unreadableProperties: (path: string) => `The properties of ${path} aren’t valid YAML, so nothing was written. Fix them in Obsidian first.`,
	notMtm: (path: string) => `Only mtm- properties are ever written, so nothing was written to ${path}.`,
	outsideVault: (path: string) => `${path} is outside the vault, so nothing was written.`,
	planOutFailed: (file: string) => `The plan couldn’t be written to ${file}.`,

	// Ambiguity.
	useHint: (field: string | undefined) =>
		field === 'action'
			? 'Use the path, or more of the title.'
			: field === 'status' || field === 'type' || field === 'sphere'
				? 'Use the ID or the whole label.'
				: 'Use the path, or more of the name.',

	// What changed.
	added: 'Added',
	addedMatter: 'Added Matter',
	changed: 'Changed',
	markedDone: 'Marked as done',
	reopened: 'Reopened',
	renamedTo: 'Renamed to',
	wouldAdd: 'Would add',
	wouldAddMatter: 'Would add Matter',
	wouldChange: 'Would change',
	wouldRenameTo: 'Would rename to',
	dryRun: 'Nothing written (dry run).',
	already: (title: string) => `“${title}” is already as asked. Nothing was changed.`,
	none: '(none)',
	updatedLinks: (links: number, notes: number) => `Updated ${plural(links, 'link', 'links')} in ${plural(notes, 'note', 'notes')}:`,
	wouldUpdateLinks: (links: number, notes: number) => `Would update ${plural(links, 'link', 'links')} in ${plural(notes, 'note', 'notes')}:`,
	lines: (lines: readonly number[]) => `${lines.length === 1 ? 'line' : 'lines'} ${lines.join(', ')}`,
	danglingLinks: (n: number) =>
		`${plural(n, 'link still points', 'links still point')} to the old name: Obsidian’s “Automatically update internal links” is off in this vault.`,
	wouldDangle: (n: number) =>
		`${plural(n, 'link would point', 'links would point')} to the old name: Obsidian’s “Automatically update internal links” is off in this vault.`,
	detailsKey: 'details',
	checklistKey: 'checklist',
	linkKey: 'link',

	// Reading.
	dueTodayOrLate: 'Due today or late',
	toSort: (n: number) => `${n} to sort in the Inbox`,
	reviewsDue: (n: number) => plural(n, 'review due', 'reviews due'),
	longWaits: (n: number) => plural(n, 'long wait', 'long waits'),
	noActions: 'No Actions match.',
	actions: (n: number) => plural(n, 'Action', 'Actions'),
	matters: (n: number) => plural(n, 'Matter', 'Matters'),
	starts: 'starts',
	due: 'due',
	waitingOn: (name: string, age: string) => `waiting on ${name}, ${age}`,
	reviewEvery: (every: string) => `review every ${every}`,
	people: 'People',
	checklist: (done: number, total: number) => `Checklist (${done} of ${total})`,
	statuses: 'Statuses',
	types: 'Action types',
	spheres: 'Spheres',
	noSpheres: 'No Spheres yet.',
	backlogMark: 'backlog',
	doneMark: 'done',
	defaultMark: 'default',
	read: 'Read',
	noMatch: 'matched nothing',
	nothingRead: 'No words quick add reads; it’s all title.',

	// Opening.
	opening: (name: string) => `Opening “${name}” in Obsidian.`,
	openFailed: (url: string) => `The system couldn’t open the link. Open it yourself: ${url}`,
	nothingToOpen: (ref: string) => `No Action or Matter matches “${ref}”.`,
} as const;
