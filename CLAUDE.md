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
- `src/model/`: pure rules (workflow flags, Matters, Actions, dates, titles, note body).
- `src/services/`: pure services (effective values, completion dates, Inbox rules, settings migrations, IDs, fuzzy matching, quick-add parsing).
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
