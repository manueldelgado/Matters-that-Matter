# Matters that Matter: Obsidian plugin

Public repository of the Matters that Matter plugin for Obsidian (plugin ID `matters-that-matter`). TypeScript bundled by esbuild into `main.js`, based on the official Obsidian sample plugin template.

## Commands

```bash
npm install
npm run dev      # watch build
npm run build    # type-check and production build
npm run lint     # eslint with eslint-plugin-obsidianmd
npm test         # Vitest unit tests
```

Set `OBSIDIAN_VAULT=<path to a test vault>` to copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/matters-that-matter/` after every build; then reload Obsidian.

CI (`.github/workflows/lint.yml`) builds, lints and tests every push. Node 22 or later.

## Layout

- `src/main.ts`: plugin lifecycle and registration only. Feature logic lives in other modules.
- `src/settings.ts`: settings types and defaults. `src/strings.ts`: all UI strings.
- `src/commands.ts`: command palette entries. `src/selection.ts`: the selected Action.
- `src/model/`: pure rules (workflow flags, Matters, Actions, dates, titles, note body).
- `src/services/`: pure services (effective values, completion dates, Inbox rules, path settings after renames, settings migrations, IDs, fuzzy matching, quick-add parsing, setup planning, the sample package).
- `src/vault/`: reads and writes through the Obsidian API. Undocumented internals live only in `vault/internal.ts`, guarded.
- `src/views/`: Bases views and `ItemView`s. `src/ui/`: settings tab, modals and shared components.
- `tests/`: Vitest unit tests mirroring `src/`. `model/` and `services/` must not import `obsidian` (it has no runtime outside the app), so they stay testable.
- `styles.css`: generated outside this repository. Never edit it by hand; style changes are made at the source and the file is regenerated.
- Keep files focused; split modules that grow beyond a few hundred lines.

## Conventions

- Code, identifiers, comments and UI strings in British English. UI text in sentence case.
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
- Menus whose items carry colour or icons that matter use `menu.setUseNativeMenu(false)`: macOS native menus show plain text only.
- There is no public submenu API: a "Move to …" item opens a second `Menu` at the same position.
- Don't name a view member `focus`: it shadows `View.focus()`, which Obsidian calls.
- A hidden tab reads `scrollLeft`/`scrollTop` as 0 and ignores writes: save and restore scroll only when `clientWidth > 0` (see `CollectionView.captureScroll`).
- Background tabs may be deferred (no view): find a leaf by `getViewState().state`, not by `leaf.view`.
- File names are case-insensitive on macOS and Windows: check collisions with `pathTaken` (`vault/notes.ts`), not `getAbstractFileByPath`.
- Obsidian rejects `\ / :` in file names even where the OS allows them: run every generated name through `sanitiseTitle`.
- Renaming a folder fires `rename` for the folder and for every file inside it; rules that follow paths must be idempotent across those events.
- Notes may use CRLF: body edits keep the note's line ending.
- Quick add parses dates on the text with tokens removed (mapped back by index), never masked with spaces, so chrono can't join across a token.
- Keep dependencies few and browser-compatible; everything is bundled into `main.js`.

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
- Run `npm run lint` before every release.
