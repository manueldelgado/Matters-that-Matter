# Matters that Matter from the command line

`mtm` reads and changes the Actions and Matters of [Matters that Matter](https://matters-that-matter.app/), the Obsidian plugin, straight from the notes in your vault. Obsidian doesn't need to be running; if it is, it picks the changes up like any other edit.

It works only with Matters data (Actions, Matters, the workflow), never deletes anything, and never changes settings. Every write says what it changed, property by property.

## Install

It needs Node.js 20 or later. Run it without installing:

```bash
npx -y matters-that-matter today --vault ~/Notes
```

Or install it once and use `mtm`:

```bash
npm install -g matters-that-matter
mtm today --vault ~/Notes
```

The vault must have Matters installed and set up (its settings are in `.obsidian/plugins/matters-that-matter/data.json`). Before setup, reads work and say so; writes are refused. Name the vault with `--vault`, or set `MTM_VAULT` once:

```bash
export MTM_VAULT=~/Notes
mtm today
```

## Commands

```
mtm today                    What matters today?
mtm add <text> [fields]      Add an Action (quick add’s words work)
mtm update <action> [fields] Change an Action
mtm done <action>            Mark as done
mtm reopen <action>          Reopen a done Action
mtm show <action>            Everything about one Action
mtm list [filters]           Actions, done hidden
mtm add-matter <name>        New Matter
mtm matters                  Matters in board order
mtm workflow                 Statuses, types and Spheres
mtm parse <text>             What quick add would make of it
mtm open <action|matter>     Open it in Obsidian
mtm mcp                      Run as an MCP server (stdio)
```

`mtm <command> --help` (or `mtm help <command>`) shows each command's fields and filters.

An Action is named by its path (`MTM/Actions/Call Marco.md`, `.md` optional) or its title. When a name matches several Actions, nothing is written and `mtm` lists them. Matters and people are named by name, path or link text; statuses, types and Spheres by label or ID.

### Adding

```bash
mtm add "Call Marco about the quote /call #Kitchen fri 10:00 !1"
```

```
Added “Call Marco about the quote”
  Kitchen renovation · Later · Call · due Fri 16 Oct 10:00 · high priority
  MTM/Actions/Call Marco about the quote.md
```

The text works as in quick add: `/type`, `#Matter`, `@person`, `!1` to `!3`, and dates in words, in English or Spanish. Fields given separately win over the text. A name that matches nothing falls back as quick add does (the default type, the Inbox, the backlog status) and the output says so in a line. Nothing else is created: no Matters, no people.

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
| `--people <name>` | A person; repeat for more. On `update` the list replaces the people. |
| `--details <text>` | The details |
| `--checklist <item>` | A checklist item; repeat for more. On `update` they are added. |
| `--link <note or address>` | A note in the vault or an `http(s)` address, added as a line at the end |

On `update`, remove a value with `--no-priority`, `--no-start`, `--no-due`, `--no-waiting-on` or `--no-people`.

### Changing

`update` is strict: a value that matches nothing is refused and nothing is written.

```
$ mtm update "Call Marco about the quote" --status Someday
No status matches “Someday”. Statuses here: Later, Next, Doing, Waiting, Done.
Nothing was changed.
```

A new title renames the note. When Obsidian's "Automatically update internal links" is on in that vault, links to it are updated too, as Obsidian would update them, and each note is listed with its lines:

```
$ mtm update "Call Marco about the quote" --title "Call Marco about the revised quote"
Renamed to “Call Marco about the revised quote”
  MTM/Actions/Call Marco about the revised quote.md
  Updated 3 links in 2 notes:
    Daily/2026-10-08.md        lines 3, 12
    Notes/Kitchen plan.md      line 7
```

When the setting is off, the links are left as they are, as Obsidian would leave them, and `mtm` says how many now point to the old name, and where. `--dry-run` shows all of this before anything is written.

`done` sets the done status and today's completion date; `reopen` moves a done Action back to the backlog status.

### Listing

`mtm list` shows open Actions grouped by Matter, in board order; late ones say "late". Filters: `--matter`, `--status`, `--type`, `--sphere`, `--person`, `--due-from <date>`, `--due-to <date>`, `--waiting`, and `--done` to include done Actions.

### Opening in Obsidian

`mtm open` opens an Action or a Matter in Obsidian, through an `obsidian://mtm-open` link that Matters handles (a version of Matters with links): `file=<path>` for an Action, `matter=<path>` for a Matter. The link names the vault by its ID from Obsidian's own list of vaults (`obsidian.json` in `~/Library/Application Support/obsidian` on macOS, `$XDG_CONFIG_HOME/obsidian` or `~/.config/obsidian` on Linux, `%APPDATA%\obsidian` on Windows), so two vaults whose folders share a name can't be confused; when the list doesn't know the folder, by the folder's name. With `--json` it prints `{ "url", "opened": true, "file" }` (or `"matter"`). Opening links on Windows hasn't been tried yet.

## Options

| Option | |
|---|---|
| `--vault <path>` | The vault (or `MTM_VAULT`) |
| `--config-dir <folder>` | The vault's configuration folder, if it isn't `.obsidian` (one folder in the vault's root) |
| `--json` | Output for scripts |
| `--dry-run` | Show what would change, without writing |
| `--help`, `-h` | Help |
| `--version`, `-V` | The version |

## Output for scripts

`--json` prints JSON on standard output. Reads give the values as they are, with both the raw properties and the values Matters shows (so scripts never re-implement its rules):

```bash
mtm list --matter Kitchen --json | jq '.[0]'
```

```json
{
  "path": "MTM/Actions/Confirm the worktop measurements.md",
  "title": "Confirm the worktop measurements",
  "matter": { "path": "MTM/Matters/Kitchen renovation.md", "name": "Kitchen renovation", "isInbox": false },
  "status": { "id": "next", "label": "Next", "category": "open" },
  "type": { "id": "call", "label": "Call" },
  "due": "2026-10-09T10:00",
  "priority": 1,
  "today": true,
  "overdue": false,
  "orphans": [],
  "raw": { "mtm-kind": "action", "mtm-status": "next", "…": "…" }
}
```

Writes give the Action (or Matter) after the write, `changed`, `dryRun`, `written`, every change (`changes`), `warnings`, the links a rename updated (`links`: each note and its lines) and `danglingLinks`, the number of links left pointing to the old name when Obsidian's "Automatically update internal links" is off. `parse` gives what quick add would make of the text with its `warnings`.

Errors are JSON on standard output too: `{ "error": { "code", "message", … } }`; when a name matches several things, `candidates` lists them, and a failed write lists in `left` any file it couldn't put back. Other warnings (settings from a newer version of Matters, setup not done) go to standard error, so standard output stays the answer.

Colour is used only when the output is a terminal and `NO_COLOR` isn't set. Nothing is said by colour alone.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done |
| 1 | Nothing matched, several things did, a value can't be read, or a note's properties aren't valid YAML so they can't be changed. Nothing was written. |
| 2 | The vault isn't ready: no vault named, no Matters settings, setup not done, or settings from a newer version of Matters (reads still work then, with a warning; writes are refused) |
| 3 | The write didn't happen: the vault changed after it was read (a note changed, appeared or went away, and again when tried a second time), or writing failed and everything was put back. In the rare case that something couldn't be put back, the message names those files. |

## Safety

- Only `mtm-` properties change, and the body only where an Action's details, checklist or link go. Everything else in a note stays as it is.
- A write is all or nothing. Every file is checked against what was read; the new contents are written to hidden temporary files next to them; then they are moved into place. If a step fails, everything already moved is put back. Before a new or renamed note takes its name, the name is checked again, so it doesn’t replace a file that appeared meanwhile. Files are only ever moved with renames, so Obsidian, if it is open, sees each change as it happens.
- Line endings and file permissions are kept.
- Writes stay inside the vault: nothing is written through a link (symlink) to a folder elsewhere. Linked files and folders are skipped when reading.
- Nothing is deleted and settings are never written.

## AI assistants (MCP)

`mtm mcp` will run Matters as an MCP server over stdio, for AI assistants. It isn't in this version yet; this section will describe how to add it to Claude Code, Claude Desktop, Codex and others, and its `--read-only` and `--tools` options.

## Licence

MIT
