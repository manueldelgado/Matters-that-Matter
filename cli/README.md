# Matters that Matter from the command line

`matters-that-matter` reads and changes the Actions and Matters of [Matters that Matter](https://matters-that-matter.app/), the Obsidian plugin, straight from the notes in your vault. Obsidian doesn't need to be running; if it is, it picks the changes up like any other edit.

It works only with the data of Matters that Matter (Actions, Matters, the workflow), never deletes anything, and never changes settings. Every write says what it changed, property by property. It can also run as an [MCP server](#mcp-server) for AI assistants.

## Install

It needs Node.js 20 or later. Run it without installing:

```bash
npx -y matters-that-matter today --vault ~/Notes
```

Or install it once, with npm:

```bash
npm install -g matters-that-matter
```

or with [Homebrew](https://brew.sh/):

```bash
brew install manueldelgado/tap/matters-that-matter
```

Then:

```bash
matters-that-matter today --vault ~/Notes
```

The vault must have Matters that Matter installed and set up (its settings are in `.obsidian/plugins/matters-that-matter/data.json`, or in the vault's other configuration folder if it has another name). Before setup, reads work and say so; writes are refused. Name the vault with `--vault`, or set `MTM_VAULT` once:

```bash
export MTM_VAULT=~/Notes
matters-that-matter today
```

## Commands

```
matters-that-matter <command> [options]

today                    What matters today?
add <text> [fields]      Add an Action (quick add’s words work)
update <action> [fields] Change an Action
done <action>            Mark as done
reopen <action>          Reopen a done Action
show <action>            Everything about one Action
list [filters]           Actions, done hidden
add-matter <name>        New Matter
matters                  Matters in board order
workflow                 Statuses, types and Spheres
parse <text>             What quick add would make of it
open <action|matter>     Open it in Obsidian
mcp                      Run as an MCP server (stdio)
```

`matters-that-matter <command> --help` (or `matters-that-matter help <command>`) shows each command's fields and filters.

An Action is named by its path (`MTM/Actions/Call Marco.md`, `.md` optional, or its full path on disk) or its title. When a name matches several Actions, nothing is written and the command lists them. Matters and people are named by name, path or link text; statuses, types and Spheres by label or ID. Commands that take no words (`today`, `list`, `matters`, `workflow`) refuse them: `list Kitchen` says to use `--matter Kitchen`.

### Adding

```bash
matters-that-matter add "Call Marco about the quote /call #Kitchen fri 10:00 !1"
```

```
Added “Call Marco about the quote”
  Kitchen renovation · Later · Call · due Fri 16 Oct 10:00 · high priority
  MTM/Actions/Call Marco about the quote.md
```

The text works as in quick add: `/type`, `#Matter`, `@person`, `!1` to `!3`, and dates in words, in the languages turned on in the plugin's settings (English and Spanish by default). Fields given separately win over the text. A name that matches nothing falls back as quick add does (the default type, the Inbox, the backlog status) and the output says so in a line. Nothing else is created: no Matters, no people.

Text that starts with a dash and a figure or a space (`-5 degrees outside`) is read as text. Text that starts with a dash and a letter goes after `--`, with every option before it: `matters-that-matter add --due fri -- "-x marks the spot"`. A value that starts like an option is given with `=`: `--details="--see the notes"`.

### Fields

| Flag | Value |
|---|---|
| `--title <text>` | The title. On `update` it renames the note. |
| `--matter <name>` | A Matter |
| `--status <status>` | A status |
| `--type <type>` | An Action type |
| `--priority <p>` | `1`, `2` or `3`, or `high`, `medium` or `low` |
| `--start <date>`, `--due <date>` | `2026-10-16`, `2026-10-16T10:00`, or words such as `"fri 10:00"` |
| `--waiting-on <name>` | A person (a note); they are added to the people too |
| `--people <name>` | A person; repeat for more. On `update` the list replaces the people: a person left out is removed, even the one the Action waits on (who it waits on doesn't change). |
| `--details <text>` | The details. A line starting with `<!-- mtm-details` or `<!-- /mtm-details` is refused: such lines mark where the details start and end |
| `--checklist <item>` | A checklist item; repeat for more. On `update` they are added; an open item the Action has already isn't added again. |
| `--link <note or address>` | A note in the vault or an `http(s)` address (spaces are written as `%20`), added as a line at the end, unless the Action has that line already |

On `update`, remove a value with `--no-priority`, `--no-start`, `--no-due`, `--no-waiting-on`, `--no-people` or `--no-details`; an empty value (`--due ""`, `--details ""`) is refused, so an unset variable in a script never removes one. On `add`, empty values are left out. An empty list filter (`--due-from ""`) is refused too. Removing who an Action waits on leaves them among its people.

### Changing

`update` is strict: a value that matches nothing is refused and nothing is written.

```
$ matters-that-matter update "Call Marco about the quote" --status Someday
No status matches “Someday”. Statuses here: Later, Next, Doing, Waiting, Done.
Nothing was changed.
```

A new title renames the note. When Obsidian's "Automatically update internal links" is on in that vault, links to it are updated too, as Obsidian would update them, and each note is listed with its lines:

```
$ matters-that-matter update "Call Marco about the quote" --title "Call Marco about the revised quote"
Renamed to “Call Marco about the revised quote”
  MTM/Actions/Call Marco about the revised quote.md
  Updated 3 links in 2 notes:
    Daily/2026-10-08.md        lines 3, 12
    Notes/Kitchen plan.md      line 7
```

When another note in the vault already has the new name, links to that note are given its path (`[[Notes/Kitchen ideas]]`), so they keep reaching it and not the renamed Action, as Obsidian does; they are listed with the others.

When the setting is off, the links are left as they are, as Obsidian would leave them, and the command says how many now point to the old name, and where. With the setting off, a new title that another note in the vault already has is refused, since links to that note could lead to the Action instead. `add` and `add-matter` never take a name another note has: the new note gets " 2". `--dry-run` shows all of this before anything is written.

`done` sets the done status and today's completion date; `reopen` moves a done Action back to the backlog status.

### Adding a Matter

```bash
matters-that-matter add-matter "Garden shed" --sphere Home --review-every 1m
```

The new Matter goes last on the board. Fields: `--icon` (a Lucide icon name, such as `house`), `--sphere`, `--state` (`active`, the default, `dormant` or `closed`), `--outcome` (what done looks like, in one line) and `--review-every` (a review rhythm such as `7d`, `2w` or `1m`).

### Listing

`matters-that-matter list` shows open Actions grouped by Matter, in board order; late ones say "late". In a terminal, long titles are cut to fit its width. Filters: `--matter`, `--status` (a done status shows done Actions), `--type`, `--sphere`, `--person` (with this person, or waiting on them), `--due-from <date>`, `--due-to <date>`, `--waiting`, and `--done` to include done Actions.

### Opening in Obsidian

`matters-that-matter open` opens an Action or a Matter in Obsidian. One whose path, title or name, or link text, matches exactly wins over a loose match of either kind (`open "Kitchen renovation"` opens the Matter even when an Action is called "Kitchen renovation budget"); several loose matches are listed. It opens it through an `obsidian://mtm-open` link that the plugin handles (Matters that Matter 1.1.0 or later): `file=<path>` for an Action, `matter=<path>` for a Matter. The link names the vault by its ID from Obsidian's own list of vaults (`obsidian.json` in `~/Library/Application Support/obsidian` on macOS, `$XDG_CONFIG_HOME/obsidian` or `~/.config/obsidian` on Linux, `%APPDATA%\obsidian` on Windows), so two vaults whose folders share a name can't be confused; when the list doesn't know the folder, by the folder's name. With `--json` it prints `{ "url", "opened": true, "file" }` (or `"matter"`). With `--dry-run` it only prints the link it would open (`"opened": false`). When the system can't open the link (nothing handles `obsidian://` links, say), the command says so, prints the link for you to open and exits with code 1. Opening links on Windows hasn't been tried yet.

## Options

| Option | |
|---|---|
| `--vault <path>` | The vault (or `MTM_VAULT`) |
| `--config-dir <folder>` | The vault's configuration folder (one folder in the vault's root). Without it, the command line finds the folder by itself: `.obsidian` when it holds the plugin's settings, else the one other configuration folder that does. Needed only when `.obsidian` doesn't hold them and several other folders do, or to choose another folder |
| `--json` | Output for scripts |
| `--dry-run` | Show what would change, without writing (warnings say what would happen) |
| `--help`, `-h` | Help |
| `--version`, `-V` | The version |

## Output for scripts

`--json` prints JSON on standard output. Reads give the values as they are, with both the raw properties and the values the plugin shows (so scripts never re-implement its rules). The first Kitchen Action in Next (shortened: the full result also has the start date, who it's waiting on and since when, the completion date and more):

```bash
matters-that-matter list --matter Kitchen --status next --json | jq '.[0]'
```

```json
{
  "path": "MTM/Actions/Confirm the worktop measurements.md",
  "title": "Confirm the worktop measurements",
  "matter": { "path": "MTM/Matters/Kitchen renovation.md", "name": "Kitchen renovation", "isInbox": false },
  "status": { "id": "next", "label": "Next", "category": "open" },
  "type": { "id": "call", "label": "Call" },
  "priority": 1,
  "due": "2026-10-09T10:00",
  "today": true,
  "overdue": false,
  "orphans": [],
  "raw": { "mtm-kind": "action", "mtm-status": "next", "…": "…" }
}
```

`show` adds the details, the checklist, the people, and the names and paths of linked notes and of attachments (embedded files that aren't notes). Writes give the Action (or Matter) after the write, `changed`, `dryRun`, `written`, every change (`changes`), `warnings`, the links a rename updated (`links`: each note and its lines) and `danglingLinks`, the number of links left pointing to the old name when Obsidian's "Automatically update internal links" is off. `parse` gives what quick add would make of the text with its `warnings`.

Errors are JSON on standard output too: `{ "error": { "code", "message", … } }`; when a name matches several things, `candidates` lists them, and a failed write lists in `left` any file it couldn't put back. Other warnings (settings from a newer version of Matters that Matter, setup not done) go to standard error, so standard output stays the answer.

Colour is used only when the output is a terminal and `NO_COLOR` isn't set. Nothing is said by colour alone.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done |
| 1 | Nothing matched, several things did, a value can't be read, the command or its options aren't right, or a note's properties aren't valid YAML, or the properties to be changed use YAML the command line can't change safely (an anchor, alias or tag on them), so they can't be changed; change those in Obsidian. Nothing was written. Also when `matters-that-matter open` couldn't open the link. |
| 2 | The vault isn't ready: no vault named, no settings of Matters that Matter, setup not done, or settings from a newer version of the plugin (reads still work then, with a warning; writes are refused) |
| 3 | The write didn't happen: the vault changed after it was read (a note changed, appeared or went away, and again when planned once more; a new note whose name is taken meanwhile is planned again a few times, each time with a name still free; another write adding a note of the same name right now), a write would have gone outside the vault, a note to be changed is read-only, or writing failed and everything was put back. If the vault changed, try again; make a read-only note writable first. In the rare case that something couldn't be put back, the message names those files. |

## Safety

- Only `mtm-` properties change, and the body only where an Action's details, checklist or link go. Everything else in a note stays as it is.
- A write is all or nothing. Every file is checked against what was read; the new contents are written to hidden temporary files next to them (named `.mtm-….tmp`; one left behind by a crash can be deleted); then they are moved into place. While a write gives a note a new name, a hidden lock file next to it (`.mtm-….lock`) keeps other runs of the command line from taking the same name; one left behind by a crash is taken over after 10 seconds, or can be deleted. Ctrl-C or `kill` during a write takes effect once the write is done or put back. If a step fails, everything already moved is put back. Before a new or renamed note takes its name, the name is checked again, so it doesn’t replace a file that appeared meanwhile. Files are only ever moved with renames, so Obsidian, if it is open, sees each change as it happens.
- Line endings and file permissions are kept. A note made read-only (say with `chmod 444`, or locked in the Finder), or one in a folder that can't be written, is never written: the whole write is refused and nothing is changed. `--dry-run` says so too, and refuses a write outside the vault as the write would.
- A written note is a new file put in the old one's place. On macOS its creation date is kept (Obsidian shows it as the note's created time). Extended attributes, such as Finder tags, aren't kept, and a hard link to the note keeps the old content.
- Writes stay inside the vault: nothing is written through a link (symlink) to a folder elsewhere. Linked files and folders are skipped when reading.
- Nothing is deleted and settings are never written.

## MCP server

`matters-that-matter mcp` runs Matters that Matter as an MCP server for AI assistants such as Claude, Codex and others. The assistant's app starts it and talks to it over standard input and output; it opens no network port. Each tool reads the vault afresh, so the assistant sees the notes as they are now, and writes go through the same all-or-nothing writer as the commands above.

### Setup

**Claude Code**

```bash
claude mcp add matters-that-matter -- npx -y matters-that-matter mcp --vault ~/Notes
```

**Claude Desktop**: in Settings → Developer → Edit Config, add the server to `claude_desktop_config.json` and restart Claude:

```json
{
  "mcpServers": {
    "matters-that-matter": {
      "command": "npx",
      "args": ["-y", "matters-that-matter", "mcp", "--vault", "/Users/you/Notes"]
    }
  }
}
```

**Codex**

```bash
codex mcp add matters-that-matter -- npx -y matters-that-matter mcp --vault ~/Notes
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.matters-that-matter]
command = "npx"
args = ["-y", "matters-that-matter", "mcp", "--vault", "~/Notes"]
```

**Grok Build** (untested): add a local (stdio) MCP server named `matters` with the command `npx` and the arguments `-y matters-that-matter mcp --vault ~/Notes`, as its documentation describes for MCP servers.

Other assistants that run local MCP servers take the same command and arguments.

If you [installed](#install) the command line, the command can be `matters-that-matter` itself, with the arguments `mcp --vault ~/Notes`.

### Tools

| Tool | What it does | Hints |
|---|---|---|
| `add_action` | Adds an Action; `text` works as in quick add | writes, not destructive |
| `update_action` | Changes an Action; strict, as `matters-that-matter update` | writes, destructive (it can replace and remove values) |
| `mark_as_done` | Marks an Action as done | writes, not destructive, idempotent |
| `reopen_action` | Reopens a done Action | writes, not destructive, idempotent |
| `get_action` | Everything about one Action | read only |
| `list_actions` | Actions, with the filters of `matters-that-matter list`; every match, not a page of them | read only |
| `get_today` | What matters today? | read only |
| `add_matter` | Adds a Matter | writes, not destructive |
| `list_matters` | Matters in board order | read only |
| `get_workflow` | Statuses, types and Spheres | read only |

Fields have the names of the command line's flags without the dashes in front (`waiting-on`, `due-from`, `review-every`), plus `text` for quick add text, `action` for the Action a tool works on and `name` for a new Matter. On `update_action`, `null` removes a value (the details too), and an empty value is refused; on `add_action`, empty values are left out. Each result is the command's output as text, plus the `--json` value as structured content; `list_actions` and `list_matters` give their list inside an object, as `{ "actions": […] }` and `{ "matters": […] }`. A name that matches several things, or a value that matches nothing, is a tool error that lists what would work, and nothing is written.

The tools carry MCP's hints, so an assistant's app can let reads run freely and ask before each write (Claude does by default).

### Options

| Option | |
|---|---|
| `--vault <path>` | The vault (or `MTM_VAULT`). Required: the server serves one vault. Before setup in Obsidian, tools that read work and say setup isn't done, and tools that write are refused |
| `--read-only` | Offer only the tools that read: `get_action`, `list_actions`, `get_today`, `list_matters`, `get_workflow` |
| `--tools <a,b>` | Offer only these tools, such as `--tools get_today,list_actions`. A name that isn't a tool stops the server before it starts (exit code 2) |
| `--dry-run` | Tools that write say what they would change, and write nothing; the server's instructions tell the assistant so |
| `--config-dir <folder>` | The vault's configuration folder, as for the commands. Needed only when `.obsidian` doesn't hold the plugin's settings and several other folders do, or to choose another folder |

```bash
npx -y matters-that-matter mcp --vault ~/Notes --read-only --tools get_today,list_actions
```

### What an assistant can and can't do

An assistant can be misled by something it reads, such as a web page, an email or a note, so the server keeps what it can do small and visible, and tells the assistant to treat titles, details and checklist items as information, never as instructions:

- It reads and writes only the data of Matters that Matter: Actions, Matters and the workflow. `get_action` gives an Action's details, checklist and the names of the notes it links to and of its attachments, never their content, and no tool reads other notes.
- Nothing is deleted and settings are never written. Every write says what it changed, property by property, so you can put it back: `reopen_action` after `mark_as_done`, another `update_action` for a change; an added Action or Matter can be deleted in Obsidian, and checklist items and links can be removed there too.
- A new title renames the note, and a rename also updates links to the Action in other notes, as Obsidian does (when its "Automatically update internal links" is on). A new Action or Matter never takes a name another note in the vault has, so links to that note keep reaching it; a rename onto such a name is refused when the vault doesn't update links.
- No Matters or people are created as a side effect: `add_action` falls back to the Inbox for a Matter it can't find, and says so.

Anything that can write your vault can change your Actions; `--read-only` and `--tools` let you offer less.

## Licence

MIT. `dist/mtm.mjs` bundles other open-source packages (the MCP SDK, zod, ajv, ajv-formats, fast-uri, chrono-node, yaml and the small packages they use); their names, versions and licences are in `dist/THIRD-PARTY-LICENSES.txt`, which comes with the package.
