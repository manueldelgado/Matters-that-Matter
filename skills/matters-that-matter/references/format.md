# The note format

How Matters that Matter stores Actions, Matters and its settings, for a tool that reads or writes the notes directly. The MCP server and the command line (`npx -y matters-that-matter`) apply all of this for you; use them when you can.

Machine-readable versions (JSON Schema, draft 2020-12) describe what a tool should write:

- Action notes: https://matters-that-matter.app/schema/v1/action.json
- Matter notes: https://matters-that-matter.app/schema/v1/matter.json
- The settings file: https://matters-that-matter.app/schema/v1/settings.json

The documentation for other tools: https://matters-that-matter.app/docs/connect/

## Where things are

- **The vault** is a folder of Markdown notes. Every Action and every Matter is one note.
- **Notes are recognised by `mtm-kind`**, never by their folder: `mtm-kind: action` or `mtm-kind: matter`. A note may live anywhere in the vault.
- **The settings** are in `data.json` in the plugin's folder under the vault's configuration folder: `.obsidian/plugins/matters-that-matter/data.json` unless the configuration folder has been renamed in Obsidian. The plugin writes this file; other tools only read it.
- **New notes** go in the folders named in the settings (`folders.actions`, `folders.matters`, `folders.people`). Changing these never moves existing notes.

## The settings file

```json
{
  "schemaVersion": 7,
  "setupDone": true,
  "folders": { "matters": "MTM/Matters", "actions": "MTM/Actions", "boards": "MTM/Boards", "people": "MTM/People" },
  "statuses": [
    { "id": "later",   "label": "Later",   "tone": "ink",      "category": "open",   "backlog": true },
    { "id": "next",    "label": "Next",    "tone": "sky",      "category": "open" },
    { "id": "doing",   "label": "Doing",   "tone": "butter",   "category": "active" },
    { "id": "waiting", "label": "Waiting", "tone": "lavender", "category": "active" },
    { "id": "done",    "label": "Done",    "tone": "mint",     "category": "closed", "done": true }
  ],
  "types": [
    { "id": "call",    "label": "Call",    "icon": "phone",          "tone": "mint" },
    { "id": "write",   "label": "Write",   "icon": "pencil-line",    "tone": "butter", "default": true }
  ],
  "spheres": [ { "id": "home", "label": "Home", "icon": "house" } ],
  "inboxPath": "MTM/Matters/Inbox.md",
  "boardPath": "MTM/Boards/Matters.base"
}
```

(Shortened: the file holds more display settings, which other tools can ignore.)

- **IDs, not labels.** Notes store `id`. Labels, tones and icons can change without touching any note. IDs the plugin makes from a label are lowercase letters, digits and hyphens; IDs taken over from existing notes keep their form. Compare IDs exactly as stored. An ID is made once and never changed.
- **Statuses** are the board's columns, in order. `category` says what a status means: `open` (not started), `active` (in progress or waiting) or `closed` (done). Exactly one status has `backlog: true` (where new Actions land and where "Reopen" puts them; never closed) and exactly one has `done: true` (what "Mark as done" sets; always closed). There can be other closed statuses: reason about the category, never about a particular ID.
- **Types** give Actions their colour and icon. Exactly one has `default: true`.
- **Spheres** group Matters (Home, Work). The list can be empty.
- **`inboxPath`** decides which Matter note is the Inbox. Its name and properties don't.
- **`setupDone`**: until it is `true`, don't write anything.
- **`schemaVersion`**: this description covers versions 6 and 7. A higher number means a newer plugin with a format this description may not cover: read, but don't write.

## Action notes

The file name (without `.md`) is the Action's title. Properties:

| Property | Form | Meaning |
|---|---|---|
| `mtm-kind` | `action` | Required. Marks the note as an Action |
| `mtm-type` | type ID | The Action type |
| `mtm-status` | status ID | The status (board column) |
| `mtm-matter` | link | The Matter it belongs to |
| `mtm-start` | date or date and time | When work starts. Optional |
| `mtm-due` | date or date and time | When it is due. Optional |
| `mtm-priority` | `1`, `2` or `3` | High, medium, low. Absent: no priority |
| `mtm-waiting-on` | link | The person it is waiting on. Optional |
| `mtm-people` | list of links | The people involved. Optional |
| `mtm-waiting-since` | date | When `mtm-waiting-on` was set or last changed |
| `mtm-completed` | date | When the Action was done |
| `mtm-order` | number | Its place within a board cell on boards ordered by hand. Written by the plugin only |
| `mtm-sample` | `true` | Sample content. Other tools never set it |

Any property without the `mtm-` prefix is the user's and is left alone. Never write unprefixed properties such as `status` or `type` on the user's behalf.

The minimal Action is a note with only `mtm-kind: action`: it shows in the Inbox, in the backlog status, with the default type. A tool that creates an Action should still set `mtm-type`, `mtm-status` and `mtm-matter` explicitly, as the plugin does.

### Value forms

- **Dates**: `YYYY-MM-DD` for a whole day, or `YYYY-MM-DDTHH:mm` for a time (24-hour clock, local time, no seconds, no time zone). Write exactly one of these two forms. Readers also meet seconds (`2026-10-20T17:57:00`, written by Obsidian's date picker) and a space instead of `T` (`2026-10-16 09:00`), and should accept them.
- **Start and due**: either, both or neither. A start date alone marks a single day. A start after the due date is shown with a warning and placed by the due date; it is never corrected automatically.
- **Links** (`mtm-matter`, `mtm-waiting-on`, each item of `mtm-people`) are wikilinks in double quotes, because YAML reads an unquoted `[[…]]` as a list: `"[[Kitchen renovation]]"`. Use the shortest link text that is unique in the vault: the file name without `.md` when no other note has that name, otherwise the path from the vault's root without `.md` (`"[[Work/Kitchen renovation]]"`). Readers resolve links as Obsidian does, so an alias (`"[[Marco Rossi|Marco]]"`) works too.
- **`mtm-people`** is always a list, even with one person:

  ```yaml
  mtm-people:
    - "[[Marco Rossi]]"
  ```

- **Priority** is a number, not text: `mtm-priority: 1`.

### File names

- Start from the title; replace each of `/ \ : * ? " < > | # ^ [ ]` with a space (they break file names or links); collapse runs of whitespace to one space; trim; drop leading dots; cap at 100 characters.
- If a note with that name already exists, in the folder or anywhere else in the vault (ignoring case), append " 2", " 3"… until the name is free. A name another note already has would make links to that note reach the new one.
- Changing an Action's title means renaming its file. Renaming outside Obsidian leaves links to the old name broken, so rename through the command line or the MCP server (which update links when Obsidian's "Automatically update internal links" is on), or let the user rename in Obsidian.

### The body

Plain Markdown, which the plugin never restructures. It reads four things from it:

- **Details**: the text at the start of the body, up to the first list item, heading, embed (`![[…]]`) or code block. When the details themselves need such a line, they sit between two comment lines, the details markers:

  ```markdown
  <!-- mtm-details: the Action's details, as edited in Matters that Matter. Keep this line. -->
  Bring:
  - the floor plan
  - the samples
  <!-- /mtm-details: end of the details. Write details above this line. -->
  ```

  The markers are recognised by `<!-- mtm-details` and `<!-- /mtm-details` at the start of a line; text outside them is not part of the details. Keep them where they are. To write details that contain a list or heading, use the markers; otherwise plain lines are enough.
- **Checklist**: Markdown checklist items (`- [ ] Ask for the revised quote`, ticked `- [x] …`) anywhere in the body. Add new items after the last existing one, or at the end of the body when there is none.
- **Linked notes**: the body's links to other notes, apart from the Matter and the people. A tool that links an Action to a note adds a line with the wikilink (in the shortest link text) at the end of the body; a web address goes on its own line in angle brackets, such as `<https://matters-that-matter.app/docs/>`.
- **Attachments**: embedded files that aren't notes.

When editing a body, change only the lines you mean to change.

### Example

```markdown
---
mtm-kind: action
mtm-type: call
mtm-status: waiting
mtm-matter: "[[Kitchen renovation]]"
mtm-start: 2026-10-12
mtm-due: 2026-10-15T10:00
mtm-priority: 1
mtm-waiting-on: "[[Marco Rossi]]"
mtm-people:
  - "[[Marco Rossi]]"
mtm-waiting-since: 2026-10-09
tags:
  - home
---
Confirm the worktop measurements before ordering.

- [ ] Ask for the revised quote
- [x] Send the floor plan

[[Kitchen measurements]]
```

## Matter notes

The file name is the Matter's name.

| Property | Form | Meaning |
|---|---|---|
| `mtm-kind` | `matter` | Required. Marks the note as a Matter |
| `mtm-icon` | Lucide icon name | `circle-dot` when absent; the Inbox uses `inbox`. Matters have no colour |
| `mtm-state` | `active`, `dormant` or `closed` | `active` when absent. Dormant and closed Matters start collapsed |
| `mtm-lane-order` | number | Its place on the board, lower first; Matters without one come after, by name |
| `mtm-sphere` | Sphere ID | Absent: no Sphere. Ignored on the Inbox |
| `mtm-review-every` | `<n>d`, `<n>w` or `<n>m` | How often it is due for a review (days, weeks, calendar months). Absent: never |
| `mtm-last-reviewed` | date | The last review |
| `mtm-outcome` | one line | What done looks like, or the standard to keep. Optional; leave it out rather than empty |
| `mtm-sample` | `true` | Sample content. Other tools never set it |

A new Matter is a note in `folders.matters` with `mtm-kind: matter`, `mtm-icon`, `mtm-state: active` and `mtm-lane-order` one more than the highest whole value used by the other Matters (not counting the Inbox), or `1` when none has one:

```markdown
---
mtm-kind: matter
mtm-icon: hammer
mtm-state: active
mtm-lane-order: 4
mtm-sphere: home
mtm-review-every: 2w
mtm-outcome: A working kitchen by Christmas
---
```

Matters are not deleted: they are closed (`mtm-state: closed`). The Inbox is always active; don't change its state, and don't remove its `mtm-kind`. Don't create a Matter named like the Inbox ("Inbox", "Inbox 2"): the plugin takes it for a copy of the Inbox.

## Person notes

Any note an Action links to in `mtm-waiting-on` or `mtm-people`. People are not an entity of their own and get no `mtm-` properties. New person notes, when the user asks for one, are plain notes in `folders.people`.

## The writer's duties

The plugin keeps two dates by watching changes. A tool that changes notes directly does the same:

- **Completion date.** When an Action moves from a status that isn't closed into a closed one, set `mtm-completed` to today, unless it is already set. When it moves from a closed status to one that isn't, remove `mtm-completed`. Moving between two closed statuses leaves it alone. Never fill it in for Actions that were done before and lack it.
- **Waiting since.** When `mtm-waiting-on` is set, or changed to another person, set `mtm-waiting-since` to today and add the same link to `mtm-people` if it isn't there. When `mtm-waiting-on` is removed, remove `mtm-waiting-since`. Never fill it in for older Actions that lack it.
- **New notes.** Use the file-name rules, and set `mtm-type`, `mtm-status` and `mtm-matter` explicitly. A new Action in a closed status gets `mtm-completed`; one with `mtm-waiting-on` gets `mtm-waiting-since`.
- **Order.** When moving an Action to another status or another Matter, remove `mtm-order`.
- **Only your lines.** Change only the `mtm-` properties you are writing. Keep every other property, the order of the lines and the body as they are.
- **Mark as done** sets the status with `done: true`; **Reopen** sets the status with `backlog: true`. Both follow the completion rule.

If Obsidian is running when the change lands, the plugin sees it too. Its own writes only set these dates when they are absent, so nothing is doubled.

## What readers compute

The plugin never rewrites invalid or missing values on its own. Readers work out effective values and show the raw value as a problem to fix:

| Property | Absent | Present but not valid |
|---|---|---|
| `mtm-status` | the backlog status | the backlog status, flagged as orphaned |
| `mtm-matter` | the Inbox | the Inbox, flagged as orphaned |
| `mtm-type` | the default type | the default type, flagged as orphaned |

"Not valid" means an ID that isn't in the settings, or, for `mtm-matter`, a link that doesn't resolve or resolves to a note without `mtm-kind: matter`. A Sphere ID not in the settings counts as no Sphere.

- **Done**: the effective status's category is `closed`.
- **Overdue**: not done, and a whole-day due date before today, or a timed due date whose time has passed.
- **Today**: not done, and due today or overdue.
- **Waiting**: not done, and `mtm-waiting-on` is set. The wait's age counts from `mtm-waiting-since`.
- **Card order** within a column: priority (1 first, none last), then due date (soonest first, undated last), then title. On boards ordered by hand, Actions with `mtm-order` come first, lowest first.
- **Review due**: an active Matter with `mtm-review-every` is due when it has never been reviewed or when one rhythm has passed since `mtm-last-reviewed`. The Inbox has no reviews.
- **Matter order**: the Inbox first (or last, by the user's choice), then `mtm-lane-order`, then name.
