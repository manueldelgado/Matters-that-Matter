# Accepted differences

Differences between `cache.json` (what Obsidian's metadata cache holds for the fixture vault) and what the file index (`src/files/`) produces for it, accepted because none of them can change an answer the plugin's rules give. `tests/files/golden.test.ts` ignores exactly the paths listed in the JSON block below, and fails when one of them no longer differs.

Each entry is `{ "path": [keys…], "reason": "…" }`: `path` is the list of keys from the root of `cache.json` (for example `["notes", "MTM/Matters/Inbox.md", "links"]`); a difference at that path or below it is ignored. `reason` says why the difference can't change an answer.

There are none: the file index reproduces `cache.json` byte for byte.

```json
[]
```

## Writes

Differences between what Obsidian leaves after applying a write case's plan (`writes/<case>/`) and what the files layer (`src/files/write.ts`) leaves for the same plan. `tests/files/writeCases.test.ts` ignores exactly the files listed in the `json writes` block below, and fails when one of them no longer differs. Each entry is `{ "case": "…", "path": "…", "reason": "…" }`: `path` is the vault path of a file in that case's result. A style difference still has to say the same thing: the test checks that both files have the same properties, as the index reads them, and the same body once line endings are made plain; `"keys": ["…"]` names properties whose values may differ. A difference in meaning must say so with `"meaning": true`, which skips those checks; nothing else can pass as style.

Two are style only: the properties read the same and every link reaches the same file. When Obsidian changes a property it writes the whole block again in its own style (comments dropped, quoting and number forms normalised, flow lists as block lists); the files layer changes only the `mtm-` keys a plan names and leaves every other byte. Seen in `update-unusual-yaml` and, for links in properties, in `rename-to-a-taken-name`.

Four are differences in meaning, accepted because Obsidian's own write damages the note or its links and the files layer is deliberately safer:

- **A byte-order mark** (`update-byte-order-mark`, `update-byte-order-mark-properties`): Obsidian's `processFrontMatter` doesn't see the properties after the mark, so it writes a new block in front of the mark with only the properties the write sets; the old block, with `mtm-kind`, stays after it as text and the note stops being an Action.
- **Fence lines with spaces after the dashes** (`update-fence-whitespace`): Obsidian reads such a block, but `processFrontMatter` doesn't find it and writes a second block in front, with the same result.
- **A percent sign in a renamed note's name** (`rename-to-a-title-with-symbols`): Obsidian writes `%` as it is in Markdown links, which then don't read back; the files layer writes `%25`.

Every other case matches Obsidian byte for byte: the renames with links updated and not updated, a name that becomes unique (`rename-name-becomes-unique`: the same links rewritten as Obsidian rewrites them), and a CRLF note (`update-crlf`).

```json writes
[
	{
		"case": "update-unusual-yaml",
		"path": "MTM/Sample/Edge cases/Edge - unusual YAML.md",
		"reason": "Style only. Obsidian writes the whole properties block again: it drops the comments, writes the flow list `aliases` and the compact list `tags` as indented lists, and `007` as `7` (the same number in YAML 1.2). The files layer changes only the mtm- keys asked for. Every property reads the same; the mtm- keys are identical."
	},
	{
		"case": "rename-to-a-taken-name",
		"path": "MTM/Sample/Edge cases/Links/Links in properties.md",
		"reason": "Style only. Updating links in properties, Obsidian writes the whole block again: `bare: [[Link target]]` (a nested list to YAML, not a link) as `bare:` with `  - - Link target`, and `inside` without quotes. The rewritten links are identical, so every link reaches the same file."
	},
	{
		"case": "update-byte-order-mark",
		"path": "MTM/Sample/Edge cases/More links/More - byte-order mark.md",
		"reason": "A difference in meaning, where the files layer is deliberately safer. Obsidian's processFrontMatter doesn't see the properties of a note that starts with a byte-order mark: it writes a new block, with only the properties the write sets, in front of the mark, and the old block (with mtm-kind) stays after it as text, so the note stops being an Action. The files layer edits the block after the mark, keeps the mark and every other property.",
		"meaning": true
	},
	{
		"case": "update-byte-order-mark-properties",
		"path": "MTM/Sample/Edge cases/More links/More - byte-order mark.md",
		"reason": "A difference in meaning, where the files layer is deliberately safer. Obsidian's processFrontMatter doesn't see the properties of a note that starts with a byte-order mark: it writes a new block, with only the properties the write sets, in front of the mark, and the old block (with mtm-kind) stays after it as text, so the note stops being an Action. The files layer edits the block after the mark, keeps the mark and every other property. The same as update-byte-order-mark, with no body edit: processFrontMatter alone.",
		"meaning": true
	},
	{
		"case": "update-fence-whitespace",
		"path": "MTM/Sample/Edge cases/Edge - fence with spaces.md",
		"reason": "A difference in meaning, where the files layer is deliberately safer. Obsidian reads properties between fence lines with spaces or tabs after the dashes, but its processFrontMatter doesn't find them: it writes a second block, with only the properties the write sets, in front of the note, and the old block (with mtm-kind and the old status) stays after it as text, so the note stops being an Action. The files layer edits the block where it is and keeps its fence lines.",
		"meaning": true
	},
	{
		"case": "rename-to-a-title-with-symbols",
		"path": "MTM/Sample/Notes/Hotel links.md",
		"reason": "A difference in meaning, where the files layer is deliberately safer. Rewriting Markdown links to a renamed note whose name has a percent sign, Obsidian writes the % as it is (`50%%20(`), which can't be percent-decoded, so the link no longer reads back as the note. The files layer writes it as %25, so the link reads back and reaches the note. Spaces, parentheses and accented letters are written the same by both.",
		"meaning": true
	}
]
```
