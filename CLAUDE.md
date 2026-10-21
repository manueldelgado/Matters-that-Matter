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
- `cli/`: the command line `matters-that-matter` and the MCP server (`matters-that-matter mcp`), Node only, bundled by `cli/build.mjs` into one file with the bundled packages' licences; published to npm as `matters-that-matter` (tags `cli-x.y.z`). Writes go through `cli/src/apply.ts`: all or nothing, plain renames only, never outside the vault.
- `schema/`: JSON Schemas for Action and Matter properties and for the settings, published at `https://matters-that-matter.app/schema/v1/`. `skills/matters-that-matter/`: the skill for AI assistants.
- `styles.css`: generated outside this repository. Never edit it by hand; style changes are made at the source and the file is regenerated.
- Keep files focused; split modules that grow beyond a few hundred lines.

## Conventions

- Code, identifiers, comments and UI strings in British English. UI text in sentence case.
- Name the plugin "Matters that Matter" in full in UI strings, CLI output, READMEs and docs, never "Matters": on its own, "Matters" means several Matters. "The plugin" may stand in where the name would repeat. Details markers already in notes keep their old wording ("as edited in Matters") until the plugin next writes the body; they are recognised by their token alone.
- The same goes for the names of things people see or type, not only copy: where a name admits spaces and capitals (a title, a display name), "Matters that Matter"; where it must be an identifier (an MCP server key, a package, a command, a file people keep), `matters-that-matter`. Never `matters` or `mtm` as a short name for the product. Setup examples add the MCP server as `matters-that-matter`.
- Formatting follows `.editorconfig`: tabs, single quotes.
- Use `this.app`, never the global `app`.
- Build DOM with `createEl`/`createDiv`; never `innerHTML` with dynamic content. Icons with `setIcon`.
- No inline styles; pass dynamic values through CSS custom properties with `setCssProps`.
- Register listeners with `registerEvent`/`registerDomEvent`/`registerInterval` so unloading is clean. Do not detach leaves in `onunload`.
- Do not set `isDesktopOnly` to `true`; avoid Node and Electron APIs so the plugin works on mobile.
- Avoid undocumented internal APIs; where one is unavoidable, isolate it, guard it and degrade gracefully.
- Keep startup light: `onload` registers things and loads settings; heavier work waits for `workspace.onLayoutReady` or first use. Debounce work triggered by vault events, and refresh only for changes that concern the view (chips and `matters` blocks check the changed path, `chipsAffected` in `services/inlineChip.ts`). Cancel pending debounces and timers on unload: one still pending would put back what unloading removed.
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
- A popover opened from a modal goes inside the modal's `.modal-container` (`anchor.closest('.modal-container') ?? doc.body`): `Modal` pulls focus back into its container, which closes a popover on `body` as soon as it takes focus. It pushes a `Scope` of its own, so Escape closes the popover and not the modal. Settings open as a modal or as a window: check both.
- Menus whose items carry colour or icons that matter use `menu.setUseNativeMenu(false)`: macOS native menus show plain text only.
- There is no public submenu API: a "Move to …" item opens a second `Menu` at the same position.
- Keyboard: every icon-only control goes through `pressable()` (`ui/components/dom.ts`: role, tab stop, Enter and Space), and a menu it opens from the keyboard opens at the element (`showMenuFor`, `menuPoint`). Native menus on macOS never appear in the DOM, so tests of menus switch them off.
- `setTooltip` writes the element's `aria-label`, and Obsidian draws the tooltip from it: an `aria-label` set afterwards replaces the tooltip. An element with a tooltip has one text for both, so make it name what the element shows as well as what the tooltip adds.
- A write started from a dialog, a menu or a watcher reports failure with `reportWriteFailed` (a log line and the notice); never leave the promise unhandled.
- A label that must end in "…" needs its text in a child element: `text-overflow` does nothing to a flex container's own text.
- Don't name a view member `focus`: it shadows `View.focus()`, which Obsidian calls.
- A hidden tab reads `scrollLeft`/`scrollTop` as 0 and ignores writes: save and restore scroll only when `clientWidth > 0` (see `CollectionView.captureScroll`).
- Background tabs may be deferred (no view): find a leaf by `getViewState().state`, not by `leaf.view`.
- File names are case-insensitive on macOS and Windows: check collisions with `pathTaken` (`vault/notes.ts`), not `getAbstractFileByPath`. Names compare as file systems compare them: `foldName` (`files/paths.ts`: NFC, then upper and lower case, so "Résumé" in either Unicode form, "Straße" and "STRASSE", "ﬁle" and "file" are one name), wherever a collision is checked, in the plugin, the operations and the command line. A new Action or Matter (quick add, a cell's "+", New Matter) also avoids a name any note in the vault has (`nameTaken`), so it can't take over that note's links; a Matter made from an Action in Process Inbox may share that Action's name.
- Obsidian rejects `\ / :` in file names even where the OS allows them: run every generated name through `sanitiseTitle`.
- Renaming a folder fires `rename` for the folder and for every file inside it; rules that follow paths must be idempotent across those events.
- Notes may use CRLF, or mixed endings: body edits keep each untouched line's own ending and give the lines they write the note's (its first line break; `keepingEndings` in `model/body.ts`); typed text is made LF first. A properties block may end the file with no line break after it: body writers start the body on a line of its own (`joinBody`). Task items count only where Obsidian's cache lists them (not in code or comments; `files/scan.ts`).
- Quick add parses dates on the text with tokens removed (mapped back by index), never masked with spaces, so chrono can't join across a token. Every date is read (overlapping readings: the longest) and the last one sets the date, so a word chrono reads as a date in ordinary text ("now") must be weak or it replaces the date meant.
- Quick add's title keeps people (the name without `@` or quotes) and dates (as typed); `/type`, `#Matter` and `!1`–`!3` leave it. A file name can't hold `:`, so `sanitiseTitle` writes a time's colon as a full stop ("10.00").
- The quick add dialog sets what its pills say, not what the text alone says (`services/quickAddPills.ts`): a pill follows its words while they're there, and once it counts (the caret left it or moved) deleting its words keeps it; × removes it and its words read as plain text (`ignoredDates`, `ignoredTokens`). People accumulate; of every other kind the pill read or changed last is set. Openers that pass tokens not typed by the user use `tokens`, not `text`, so their words stay out of the title.
- The dialog's status has no token in the text: it comes from the status token's menu (`showStatusPicker`), then the column the dialog was opened from, then the backlog (`chosenStatus` and `contextStatus` in `draftOf`), and stays for Shift+Enter. Controls in the dialog that must not take the input's focus (the status token, the chips' ×) prevent `mousedown`; the keyboard reaches them with Tab.
- chrono reads any short word after a time as a time zone, in any case ("5pm art", "3pm cat"). Quick add counts one only in capitals or with a sign (`zoneOf` in `services/quickAddParser.ts`); other words aren't part of the date. A date with a zone, and a date in figures that names no real day, is an `invalid-date` chip: no date set, its text kept in the title. Read chrono's day from its components (`ymdOf`), never through `c.date()` and the host's zone; "today" and "now" come from `wallClock(now, timeZone)`.
- Times: an hour from 1 to 7 means the afternoon only when written with one digit and no am/pm ("at 3", "a las 5"); `06:30` and the stored form are taken as written. In a range, an ambiguous end takes the reading that gives the shortest range ending after the start. chrono-en moves a range's ambiguous end into the afternoon after an afternoon start ("18:00 to 6:00" comes back as 18:00 to 18:00), so the end is read again on its own (`timeEndAsWritten`); chrono-es takes a lone "a" after a time for a.m. and can start a time inside "hasta", which `parseSpanish` corrects. A parser test asserts the title as well as the date: a word lost, or one read into the date, is the usual bug.
- Matter notes open as their overview through a guarded `setViewState` wrapper (`vault/internal.ts`). To open a Matter as a note on purpose, call `plugin.openMatterNote(file, leaf)`; a plain `openFile` shows the overview.
- The new tab panel lives in Obsidian's empty view, which has no API: it is added and removed in `views/today/` like the note banners, guarded, and Obsidian's own commands run through `runCommand` (`vault/internal.ts`).
- `workspace.iterateRootLeaves` stops at the first callback that returns a truthy value: collect leaves with `(leaf) => void list.push(leaf)`.
- Phones: the board checks `is-phone` on `body` when it renders and shows the swipe board (`views/bases/board/swipeRender.ts`): one Matter at a time, pills, no drag. To try it on desktop, run `app.emulateMobile(true)` in the console, add `is-phone` to `body`, then reopen the board. Swipes and long-press need a real touch screen.
- Phones and the on-screen keyboard: Obsidian shrinks its workspace but not the modal layer, and puts the keyboard's height in `--keyboard-height` on the root (0 when it's down). A sheet anchored to the bottom adds it as `margin-bottom` (quick add). A phone modal's `.modal-content` is a positioned scroller that clips anything placed outside it: make it `position: static` for a popup that must leave the sheet.
- Long-press goes through `attachLongPress` (`views/bases/board/longPress.ts`): 450 ms within 8 px, so a press that moves stays a scroll; it swallows the click that ends it, so the card isn't also selected.
- CodeMirror packages (`@codemirror/state`, `view`, `language`) are provided by Obsidian at runtime and stay external in the build; they are dev dependencies only for types, pinned to the versions Obsidian's own package uses.
- Chips for links to Actions: reading view wraps the existing `a.internal-link` (so Obsidian's click and hover stay), Live Preview replaces the link with a widget only when the cursor and selections are outside it. Links are found in the text (`services/inlineChip.ts`); the editor's syntax tree, whose node names are Obsidian's and undocumented, only keeps code, math, comments and front matter out.
- The `matters` code block (`views/notes/mattersEmbed.ts`) is a `MarkdownRenderChild`: its listeners live and die with the rendered block. Its query reuses quick add's parser (`services/embedQuery.ts`), so tokens mean the same in both.
- Keep dependencies few and browser-compatible; everything is bundled into `main.js`. The plugin must never import `cli/` (Node only); `yaml` and the MCP SDK reach only the CLI bundle.
- Sorting with `localeCompare` and no locale follows the host's default locale.
- Obsidian links: Obsidian's URI handler overwrites an `action` parameter with the link's own name, so `mtm-open` names an Action with `file=`. Everything arriving through a link is made inert (`services/linkInput.ts`); calls wait until the layout and settings are ready.
- Outside writers (the CLI, the MCP server) rename notes with plain renames: a link-then-unlink rename leaves Obsidian believing the old file still exists.
- The CLI writes all or nothing by staging temporary files and renaming them into place, so a written note is a new file: its creation date is put back on macOS (`keepCreated` in `cli/src/apply.ts`), while extended attributes and hard links are not kept. New names are reserved by hidden lock files (`cli/src/locks.ts`). Never tell files apart by inode alone: Linux gives a new file the number of one just deleted; a lock's age (its modification time) tells a fresh one from a stale one. Writes are synchronous, so a signal waits for the write to finish (`cli/src/signals.ts`).
- CI runs on Linux. Tests of macOS-only behaviour (creation dates, `chflags`) skip elsewhere, and CI catches what macOS hides: let it pass before publishing the CLI. A test that needs Obsidian's API mocks it with `vi.mock('obsidian')` (`tests/vault/actionWrites.test.ts`); keep such tests few.
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
