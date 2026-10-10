# Accepted differences

Differences between `cache.json` (what Obsidian's metadata cache holds for the fixture vault) and what the file index (`src/files/`) produces for it, accepted because none of them can change an answer the plugin's rules give. `tests/files/golden.test.ts` ignores exactly the paths listed in the JSON block below, and fails when one of them no longer differs.

Each entry is `{ "path": [keys…], "reason": "…" }`: `path` is the list of keys from the root of `cache.json` (for example `["notes", "MTM/Matters/Inbox.md", "links"]`); a difference at that path or below it is ignored. `reason` says why the difference can't change an answer.

There are none: the file index reproduces `cache.json` byte for byte.

```json
[]
```

## Writes

Differences between what Obsidian leaves after applying a write case's plan (`writes/<case>/`) and what the files layer (`src/files/write.ts`) leaves for the same plan. `tests/files/writeCases.test.ts` ignores exactly the files listed in the `json writes` block below, and fails when one of them no longer differs. Each entry is `{ "case": "…", "path": "…", "reason": "…" }`: `path` is the vault path of a file in that case's result. A style difference still has to say the same thing: the test checks that both files have the same properties, as the index reads them, and the same body once line endings are made plain; `"keys": ["…"]` names properties whose values may differ. A difference in meaning must say so with `"meaning": true`, which skips those checks; nothing else can pass as style.

Three are style only: the properties read the same and every link reaches the same file. When Obsidian changes a property it writes the whole block again in its own style (comments dropped, quoting and number forms normalised, flow lists as block lists, LF lines even in a CRLF note); the files layer changes only the `mtm-` keys a plan names and leaves every other byte.

One is a difference in meaning, accepted because the files layer is deliberately safer: on a note that starts with a byte-order mark, Obsidian's own write loses the mark and the properties it doesn't set.

Every other case, the renames with links updated and not updated included, matches Obsidian byte for byte.

```json writes
[
	{
		"case": "update-crlf",
		"path": "MTM/Sample/Edge cases/Edge - Windows line endings.md",
		"reason": "Style only. Obsidian writes the lines of the properties block with LF inside a note with CRLF line endings; the files layer keeps CRLF throughout. Every property reads the same."
	},
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
		"reason": "A difference in meaning, where the files layer is deliberately safer. On a note that starts with a byte-order mark, Obsidian's processFrontMatter drops the mark and every property the write doesn't set (mtm-kind and mtm-sample are gone), so the note stops being an Action. The files layer edits the properties after the mark, keeps the mark and every other property, and doesn't copy that loss.",
		"meaning": true
	}
]
```
