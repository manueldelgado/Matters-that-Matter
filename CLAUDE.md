# Matters that Matter: Obsidian plugin

Public repository of the Matters that Matter plugin for Obsidian (plugin ID `matters-that-matter`).

## Conventions

- Code, identifiers, comments and UI strings in British English. UI text in sentence case.
- TypeScript, built with esbuild from the official Obsidian sample plugin template.
- Use `this.app`, never the global `app`.
- Build DOM with `createEl`/`createDiv`; never `innerHTML` with dynamic content.
- Register listeners with `registerEvent`/`registerDomEvent`/`registerInterval`.
- Do not set `isDesktopOnly`; avoid Node and Electron APIs.
- Run `eslint-plugin-obsidianmd` before every release.

## Styles

`styles.css` is generated outside this repository. Never edit it by hand; style changes are made at the source and the file is regenerated.

## Releases

`manifest.json` version is `x.y.z` and the GitHub release tag is identical (no `v` prefix). Release assets: `main.js`, `manifest.json`, `styles.css`.
