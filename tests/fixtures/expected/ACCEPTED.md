# Accepted differences

Differences between `cache.json` (what Obsidian's metadata cache holds for the fixture vault) and what the file index (`src/files/`) produces for it, accepted because none of them can change an answer the plugin's rules give. `tests/files/golden.test.ts` ignores exactly the paths listed in the JSON block below, and fails when one of them no longer differs.

Each entry is `{ "path": [keys…], "reason": "…" }`: `path` is the list of keys from the root of `cache.json` (for example `["notes", "MTM/Matters/Inbox.md", "links"]`); a difference at that path or below it is ignored. `reason` says why the difference can't change an answer.

There are none: the file index reproduces `cache.json` byte for byte.

```json
[]
```
