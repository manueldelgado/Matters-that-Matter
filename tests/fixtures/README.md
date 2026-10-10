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

## Write cases: what Obsidian writes

`write-cases.json` lists operations on the fixture (add, update each field, mark as done, reopen, waiting on someone, add a Matter, renames with links of every kind with "Automatically update internal links" on and off, a CRLF note, a note with a byte-order mark, hand-written YAML), each as `{ name, description, op, input, now }` with the input as other tools pass it (public field names such as `waiting-on`), plus, where a case needs them, `alwaysUpdateLinks` (the link setting for the case; on when absent) and `setup` (notes added to the fixture first, by path). `tests/files/writeCases.ts` runs a case: it reads the fixture (with the setup notes and the link setting), runs the operation, and applies the plan with the files layer.

- **`expected/plans/<case>.json`**: each case's plan with its link setting and setup notes, and `expected/plans/_fixture.json`, the SHA-256 of every file of the fixture, so a console script in Obsidian can check it starts from the fixture as committed and then apply each plan exactly as the plugin applies plans: notes created and properties written with Obsidian's own `processFrontMatter`, bodies changed with the plugin's own body edits on what Obsidian wrote, renames through Obsidian (with its own link updating when the case has it on). Generated, never edited by hand; `tests/files/writeCases.test.ts` fails when they are out of date. Regenerate them with:

  ```bash
  MTM_WRITE_PLANS=1 npx vitest run tests/files/writeCases.test.ts
  ```

- **`expected/writes/<case>/`**: what Obsidian left after applying the plan to a fresh copy of the fixture: every file that differs from the fixture (setup notes included), at its vault path, `removed.json` (the paths that no longer exist, sorted) and, where present, `unresolved.json` (how many links pointed nowhere before and after the renames, which the files layer's count must match). The files layer must leave the same bytes, apart from the differences listed in `expected/ACCEPTED.md`. A case without a folder is skipped, waiting for Obsidian's results.
