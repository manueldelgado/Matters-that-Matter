# Accepted differences

Differences between `cache.json` (what Obsidian's metadata cache holds for the fixture vault) and what the file index (`src/files/`) produces for it, accepted because none of them can change an answer the plugin's rules give. `tests/files/golden.test.ts` ignores exactly the paths listed in the JSON block below, and fails when one of them no longer differs.

Each entry is `{ "path": [keys…], "reason": "…" }`: `path` is the list of keys from the root of `cache.json` (for example `["notes", "MTM/Matters/Inbox.md", "links"]`); a difference at that path or below it is ignored. `reason` says why the difference can't change an answer.

There are none: the file index reproduces `cache.json` byte for byte.

```json
[]
```

## Writes

Differences between what Obsidian leaves after applying a write case's plan (`writes/<case>/`) and what the files layer (`src/files/write.ts`) leaves for the same plan, accepted because they are style only, never meaning: the properties read the same and every link reaches the same file. `tests/files/writeCases.test.ts` ignores exactly the files listed in the `json writes` block below, and fails when one of them no longer differs.

Each entry is `{ "case": "…", "path": "…", "reason": "…" }`: `path` is the vault path of a file in that case's result.

None are listed until Obsidian's results exist. Where they are expected, and why the files layer keeps its own result:

- **Whole properties blocks.** When Obsidian changes a property it writes the whole block again in its own style: comments go, quoting and number forms are normalised (`'next'` → `next`, `007` → `7`), flow lists become block lists. The files layer changes only the `mtm-` keys a plan names and leaves every other byte. Expected in `update-unusual-yaml` (`Edge - unusual YAML.md`) and, for links in properties, in `rename-to-a-taken-name` (`Links in properties.md`, whose `bare: [[Link target]]` is a nested list to YAML).
- **Line endings in properties.** Obsidian writes the lines of a properties block with `\n`, also in a note with CRLF line endings; the files layer keeps CRLF throughout. Expected in `update-crlf` (`Edge - Windows line endings.md`).
- **To check, not to accept unseen:** a note starting with a byte-order mark (`update-byte-order-mark`). The files layer edits the block after the mark and keeps it; if Obsidian's write doesn't find the block there, its result differs in meaning and needs a decision.

```json writes
[]
```
