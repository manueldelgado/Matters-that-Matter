# Test fixtures

## `mtm-fixture/`: a vault for tests

A small Obsidian vault the file-level code is checked against:

- **The sample package**, exactly as setup's "sample content" option writes it on Friday 9 October 2026 at 12:00 (local time; dates in notes are relative to that day): Matters, Actions, people, notes, an attachment, the Inbox and the board.
- **Edge cases** in `MTM/Sample/Edge cases/`: values the plugin must survive without rewriting them (unknown status, type and Sphere, a Matter that doesn't exist or isn't a Matter, a Matter link with an alias or without brackets, people as one link instead of a list, start after due, dates with seconds or a space, done without a completion date, waiting without a date, a person outside the people folder), notes whose properties aren't what they seem (invalid YAML, a block that isn't closed, an empty block, a block after a blank line, only `mtm-kind: action`, comments and hand-written YAML), CRLF line endings, task list forms, and in `Links/` links in every form Obsidian reads: duplicate names in two folders (one of them a Matter), names that differ only in case, aliases, headings, block references, Markdown links with `%20`, angle brackets and spaces, relative `../` and `./` links, links in properties, embeds, an escaped pipe in a table, and links that must not count (inline and fenced code, indented code, HTML and Obsidian comments, escaped brackets).
- **`.obsidian/plugins/matters-that-matter/data.json`**: the plugin's settings as setup leaves them, with the sample's Spheres.
- **`.obsidian/app.json`**: the link settings (`alwaysUpdateLinks: true`, `newLinkFormat: "shortest"`, `useMarkdownLinks: false`).

It is generated; never edit it by hand. To change it, change `scripts/fixture-vault.mjs` (or the sample package in `src/services/samplePackage.ts`) and run:

```bash
npm run fixture
```

`tests/scripts/fixtureVault.test.ts` regenerates it into a temporary folder and compares every file byte for byte, so a stale fixture fails the tests. It also checks that every edge case is present. The output is deterministic: the same date always gives the same bytes. Git keeps no empty folders, so `MTM/Actions` and `MTM/People`, which setup creates empty, are missing from the committed copy; the comparison covers files only.

### Opening it in Obsidian

Copy it first; never open or change the committed folder. Obsidian adds its own files to `.obsidian/` (`workspace.json` and others) on first open. For the plugin to run in the copy, put a build (`main.js`, `manifest.json`, `styles.css`) in `.obsidian/plugins/matters-that-matter/`, list the plugin in `.obsidian/community-plugins.json` (`["matters-that-matter"]`), turn on community plugins when Obsidian asks, and keep the Bases core plugin on for the board. Reading the metadata cache needs only the notes and `app.json`.

## `expected/`: what Obsidian reads

`expected/cache.json` comes from Obsidian itself: a console script, run in a real vault holding a copy of `mtm-fixture`, dumps what Obsidian's metadata cache holds for every note (properties, the end of the properties block, body links and embeds with their original text, links in properties, task lines, how each link resolves, resolved and unresolved link counts) the link text Obsidian writes from every Action to every note in each of its three link formats, and a SHA-256 of every note, so a test can tell a stale dump from an index difference. Positions are lines (and columns), except the end offset of the properties block; object keys are sorted; arrays are in document order, or sorted where order means nothing. The file-level index must reproduce it.

Never edit it by hand. When the fixture changes, the dump is run again in Obsidian and the file replaced. Until it exists, the tests that compare against it are skipped.
