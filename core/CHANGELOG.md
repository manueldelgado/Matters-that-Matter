# The core's changelog

The core is the part of Matters that Matter that every product shares: the note format's rules, the operations and the files layer, bundled as one script, `mtm-core.js`, for JavaScript hosts other than Node and Obsidian. Its versions are tagged `core-x.y.z` in this repository, apart from the plugin's and the command line's. To get the bundle for a tag, check it out and run `npm ci && npm run build:core` (it writes `core/dist/mtm-core.js`); its JSON Schemas are in `core/schema/`.

## 0.1.0 (16 October 2026)

The first version, from plugin 1.1.4 and command line 0.5.0.

- **Boundary version 1.** One global, `mtmCore`, whose `call(json)` takes a request and returns a response, both JSON, and never throws: a failure is a response with `ok: false` and an error code. Every response carries the boundary version; a request may name the version it was written for, and a different one is refused (`unsupported-boundary`). The request and response are described by `core/schema/request.json` and `core/schema/response.json`.
- **The operations.** `addAction`, `updateAction`, `markAsDone`, `reopenAction` and `addMatter` return a plan of writes, what they change and their warnings, without touching a file; with `apply`, also what every file would hold. `getAction`, `listActions`, `getToday`, `listMatters` and `getWorkflow` read. An Action or a Matter can be named by its path, its title or name, or its `mtm-id`.
- **The snapshot.** The caller hands over the vault as files and contents with the plugin's settings, the link settings, `now` and an IANA `timeZone` (today, overdue and the dates written follow its wall clock). Optional: each note's version and the settings' version, which plans record as their basis, and new IDs for `mtm-id`, used in order and counted in `idsUsed`.
- **Plans** carry their basis (the files they write or rely on, by version, and the paths that must stay free) and the settings' version, so the caller can check them before it writes.
- **`mtm-id`.** A new Action or Matter gets one right after `mtm-kind`, and one without gets it with its first write; a value already there is never replaced.
- **`mergeNote`**: three versions of one note merged into one. Properties key by key, people as a set, the body line by line, task items by their text, both versions kept where both changed the same lines, and a decision listed for everything not kept as written. It needs no snapshot.
- **One reading of task items**, as Obsidian's cache lists them: in a quote too, not after a non-breaking space.
- **Hosts without Node's globals.** The bundle brings its own `URL` for web links, `structuredClone` and `console`, and needs no module loader, timers or `crypto`. Tested in a context with only the language's built-ins, and in macOS's JavaScriptCore.
