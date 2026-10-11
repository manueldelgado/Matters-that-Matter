# Matters that Matter: Obsidian plugin

Public repository of the Matters that Matter plugin for Obsidian (plugin ID `matters-that-matter`). TypeScript bundled by esbuild into `main.js`, based on the official Obsidian sample plugin template.

## Commands

```bash
npm install
npm run dev      # watch build
npm run build    # type-check and production build
npm run lint     # eslint with eslint-plugin-obsidianmd
npm test         # Vitest unit tests
npm run build:cli  # the command line and MCP server into cli/dist/mtm.mjs
npm run perf     # indexing speed of the files layer on a generated 5,000-note vault (not in npm test)
npm run fixture  # regenerate tests/fixtures/mtm-fixture from scripts/fixture-vault.mjs
```

Set `OBSIDIAN_VAULT=<path to a test vault>` to copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/matters-that-matter/` after every build; then reload Obsidian.

CI (`.github/workflows/lint.yml`) builds, lints and tests every push. Node 22 or later.

## Layout

- `src/main.ts`: plugin lifecycle and registration only. Feature logic lives in other modules.
- `src/settings.ts`: settings types and defaults. `src/strings.ts`: all UI strings.
- `src/commands.ts`: command palette entries. `src/selection.ts`: the selected Action. `src/links.ts`: the `obsidian://mtm-add`, `mtm-quick-add` and `mtm-open` handlers.
- `src/model/`: pure rules (workflow flags, Matters, Actions, dates, titles, note body).
- `src/services/`: pure services (effective values, completion dates, Inbox rules, path settings after renames, settings migrations, IDs, fuzzy matching, quick-add parsing, setup planning and reconnecting to existing notes, the sample package, the models behind the views, card order, the new tab panel, the review session, the phone board, chips for links to Actions and the `matters` block, settings controls, Show on board, link input made inert, rate limits, name matching for the operations).
- `src/ops/`: the operations other tools use (add, update, mark as done, reopen, get and list Actions, today, add Matter, list Matters, workflow, parse quick add). Each takes a `Snapshot` of the vault and returns a result, warnings, a plan of writes and the changes; it never touches files. Public field names are in `ops/fieldNames.ts`.
- `src/files/`: the vault as plain text, as Obsidian reads and writes it: where the properties block sits (`fences.ts`, which the plugin also uses through `vault/notes.ts` to make fence lines plain before `processFrontMatter`), properties, links, tasks, link resolution and link text, the index (`VaultIndex`), a `Snapshot` over it, applying a plan to file contents (`write.ts`) and renames with link rewriting (`rename.ts`). Checked against Obsidian's own cache and writes (`tests/fixtures/expected/`).
- `src/vault/`: reads and writes through the Obsidian API (including a `Snapshot` over the metadata cache and `planWrites.ts`, which applies a plan). Undocumented internals live only in `vault/internal.ts`, guarded.
- `src/views/`: Bases views, `ItemView`s, the note banners, chips and the `matters` block in notes, and the new tab panel. `src/ui/`: settings tab, modals and shared components.
- `tests/`: Vitest unit tests mirroring `src/`, plus `tests/cli`, `tests/schema`, `tests/skills` and `tests/scripts`. `model/`, `services/`, `ops/` and `files/` must not import `obsidian` (it has no runtime outside the app) or `node:*`, so they stay testable and portable. The Vitest config sets `LC_ALL=en_GB.UTF-8`.
- `tests/fixtures/`: the fixture vault (`mtm-fixture/`, written by `scripts/fixture-vault.mjs`, never edited by hand) and what Obsidian says about it (`expected/cache.json`, `expected/writes/`, `expected/plans/`); differences the files layer keeps on purpose are listed in `expected/ACCEPTED.md`. Changing the fixture means asking Obsidian again (the golden test checks each note's hash first).
- `cli/`: the command line `mtm` and the MCP server (`mtm mcp`), Node only, bundled by `cli/build.mjs` into one file with the bundled packages' licences; published to npm as `matters-that-matter` (tags `cli-x.y.z`). Writes go through `cli/src/apply.ts`: all or nothing, plain renames only, never outside the vault.
- `schema/`: JSON Schemas for Action and Matter properties and for the settings, published at `https://matters-that-matter.app/schema/v1/`. `skills/matters-that-matter/`: the skill for AI assistants.
- `styles.css`: generated outside this repository. Never edit it by hand; style changes are made at the source and the file is regenerated.
- Keep files focused; split modules that grow beyond a few hundred lines.

## Conventions

- Code, identifiers, comments and UI strings in British English. UI text in sentence case.
- Name the plugin "Matters that Matter" in full in UI strings, CLI output, READMEs and docs, never "Matters": on its own, "Matters" means several Matters. "The plugin" may stand in where the name would repeat. Details markers already in notes keep their old wording ("as edited in Matters") until the plugin next writes the body; they are recognised by their token alone.
- Formatting follows `.editorconfig`: tabs, single quotes.
- Use `this.app`, never the global `app`.
- Build DOM with `createEl`/`createDiv`; never `innerHTML` with dynamic content. Icons with `setIcon`.
- No inline styles; pass dynamic values through CSS custom properties with `setCssProps`.
- Register listeners with `registerEvent`/`registerDomEvent`/`registerInterval` so unloading is clean. Do not detach leaves in `onunload`.
- Do not set `isDesktopOnly` to `true`; avoid Node and Electron APIs so the plugin works on mobile.
- Avoid undocumented internal APIs; where one is unavoidable, isolate it, guard it and degrade gracefully.
- Keep startup light: `onload` registers things and loads settings; heavier work waits for `workspace.onLayoutReady` or first use. Debounce work triggered by vault events.
- Commands via `this.addCommand` with stable IDs (never rename after release); no default hotkeys.
- Persist settings with `loadData`/`saveData`.
- Settings tab: declarative `getSettingDefinitions()`, no `display()` (`minAppVersion` 1.13.0 or later). Custom UI goes in `render` rows. Re-render an open tab with `this.update()` (it re-runs `render` rows too); `display()` doesn't refresh declarative tabs.
  A definition with an empty `name` is not rendered at all; for a description-only row use `render: (s) => { s.setName('').setDesc(…); }`.
- Settings from sync replace the settings object: anything holding the old arrays (an open settings tab, caches) must re-read them on `settings-changed` with `external`.
- Type checks on DOM nodes and UI events use `x.instanceOf(X)`, not `instanceof` (cross-window safe). `obsidianmd/prefer-instanceof` misses some cases (`instanceof HTMLElement`, `instanceof MouseEvent`), so grep for `instanceof` before committing. A value of unknown type needs a guard before `.instanceOf` (see `isHTMLElement` in `vault/internal.ts`).
- Right after a write, `metadataCache.getFileCache(file)` returns `null` until the note is parsed again. Don't treat that as "not our note": wait for the `changed` event, and match on the path you care about rather than on cached view state.
- `ItemView` state must not use a `file` key: Obsidian reads it as a note to open and swaps in a Markdown view.
- An `ItemView`'s header title isn't refreshed after `setState`; call `refreshViewTitle` (`vault/internal.ts`).
- Since Obsidian 1.13 a modal's close button is `.modal-header-button`, absolutely placed in `.modal`; `.modal-close-button` no longer exists.
- Giving a modal its own `Scope` (for extra shortcuts) replaces the one that held Escape: register Escape again, leaving it to a field being typed in.
- Menus whose items carry colour or icons that matter use `menu.setUseNativeMenu(false)`: macOS native menus show plain text only.
- There is no public submenu API: a "Move to …" item opens a second `Menu` at the same position.
- Don't name a view member `focus`: it shadows `View.focus()`, which Obsidian calls.
- A hidden tab reads `scrollLeft`/`scrollTop` as 0 and ignores writes: save and restore scroll only when `clientWidth > 0` (see `CollectionView.captureScroll`).
- Background tabs may be deferred (no view): find a leaf by `getViewState().state`, not by `leaf.view`.
- File names are case-insensitive on macOS and Windows: check collisions with `pathTaken` (`vault/notes.ts`), not `getAbstractFileByPath`. A new Action or Matter (quick add, a cell's "+", New Matter) also avoids a name any note in the vault has (`nameTaken`), so it can't take over that note's links; a Matter made from an Action in Process Inbox may share that Action's name.
- Obsidian rejects `\ / :` in file names even where the OS allows them: run every generated name through `sanitiseTitle`.
- Renaming a folder fires `rename` for the folder and for every file inside it; rules that follow paths must be idempotent across those events.
- Notes may use CRLF: body edits keep the note's line ending.
- Quick add parses dates on the text with tokens removed (mapped back by index), never masked with spaces, so chrono can't join across a token.
- Matter notes open as their overview through a guarded `setViewState` wrapper (`vault/internal.ts`). To open a Matter as a note on purpose, call `plugin.openMatterNote(file, leaf)`; a plain `openFile` shows the overview.
- The new tab panel lives in Obsidian's empty view, which has no API: it is added and removed in `views/today/` like the note banners, guarded, and Obsidian's own commands run through `runCommand` (`vault/internal.ts`).
- `workspace.iterateRootLeaves` stops at the first callback that returns a truthy value: collect leaves with `(leaf) => void list.push(leaf)`.
- Phones: the board checks `is-phone` on `body` when it renders and shows the swipe board (`views/bases/board/swipeRender.ts`): one Matter at a time, pills, no drag. To try it on desktop, run `app.emulateMobile(true)` in the console, add `is-phone` to `body`, then reopen the board. Swipes and long-press need a real touch screen.
- Long-press goes through `attachLongPress` (`views/bases/board/longPress.ts`): 450 ms within 8 px, so a press that moves stays a scroll; it swallows the click that ends it, so the card isn't also selected.
- CodeMirror packages (`@codemirror/state`, `view`, `language`) are provided by Obsidian at runtime and stay external in the build; they are dev dependencies only for types, pinned to the versions Obsidian's own package uses.
- Chips for links to Actions: reading view wraps the existing `a.internal-link` (so Obsidian's click and hover stay), Live Preview replaces the link with a widget only when the cursor and selections are outside it. Links are found in the text (`services/inlineChip.ts`); the editor's syntax tree, whose node names are Obsidian's and undocumented, only keeps code, math, comments and front matter out.
- The `matters` code block (`views/notes/mattersEmbed.ts`) is a `MarkdownRenderChild`: its listeners live and die with the rendered block. Its query reuses quick add's parser (`services/embedQuery.ts`), so tokens mean the same in both.
- Keep dependencies few and browser-compatible; everything is bundled into `main.js`. The plugin must never import `cli/` (Node only); `yaml` and the MCP SDK reach only the CLI bundle.
- Obsidian links: Obsidian's URI handler overwrites an `action` parameter with the link's own name, so `mtm-open` names an Action with `file=`. Everything arriving through a link is made inert (`services/linkInput.ts`); calls wait until the layout and settings are ready.
- Outside writers (the CLI, the MCP server) rename notes with plain renames: a link-then-unlink rename leaves Obsidian believing the old file still exists.
- Obsidian reads a properties block only when the note's first line is exactly `---` (after an optional byte-order mark); the closing line may have trailing spaces. Its `processFrontMatter` adds a second block in front of a note that starts with a byte-order mark or whose closing line has trailing spaces, so the plugin writes properties through `processFrontMatter` in `vault/notes.ts`, which makes such fence lines plain first; the files layer edits such notes in place.

## Privacy and policies

Follow Obsidian's [developer policies](https://docs.obsidian.md/Developer+policies) and [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines):

- Local only: no network requests, no telemetry.
- Read and write only inside the vault, and only what the feature needs.
- Never execute remote code.

## Releases

- Bump with `npm version <x.y.z>`: it updates `manifest.json` and `versions.json` (plugin version → `minAppVersion`).
- Keep `minAppVersion` accurate when using newer APIs.
- The GitHub release tag equals the manifest version (no `v` prefix). Pushing the tag runs `.github/workflows/release.yml`, which creates a draft release with `main.js`, `manifest.json` and `styles.css`.
- Never change the plugin `id`.
- The CLI has its own version (`cli/package.json`) and its own tags, `cli-x.y.z`; it is published to npm from `cli/` (`npm publish --access public`), never by the plugin's release workflow, which reacts only to `x.y.z` tags.
- Run `npm run lint` before every release.
