---
mtm-sample: true
---
Every kind of link, for checking how links are read and resolved.

## Wikilinks

- Plain: [[Link target]]
- With the extension: [[Link target.md]]
- With an alias: [[Link target|the target]]
- To a heading: [[Link target#First heading]]
- To a heading, with an alias: [[Link target#Second heading|second]]
- To a block: [[Link target#^block-one]]
- To a block, with an alias: [[Link target#^list-block|the item]]
- To a heading in this note: [[#Wikilinks]]
- By path: [[MTM/Sample/Edge cases/Links/Link target]]
- Relative: [[../Zoe Zimmer]]
- Twin names: [[Edge - twin]] and [[Elsewhere/Edge - twin]]
- Case: [[link target]], [[LINK TARGET]], [[casing]] and [[Casing]]
- To a Matter: [[Kitchen renovation]]
- To a person: [[Alice Archer]]
- To a file: [[Kitchen floor plan.svg]]
- To nothing: [[Nowhere to be found]]

## Markdown links

- Encoded: [encoded](Link%20target.md)
- In angle brackets: [brackets](<Link target.md>)
- With spaces: [spaces](Link target.md)
- Without the extension: [no extension](Link%20target)
- To a heading: [heading](Link%20target.md#First%20heading)
- Up a folder: [up](../Edge%20-%20unknown%20status.md)
- From this folder: [here](./Casing.md)
- By path: [path](MTM/Sample/Edge%20cases/Links/Link%20target.md)
- A web page: [web](https://example.com/page.md)
- To nothing: [nowhere](Nowhere.md)

## Embeds

![[Link target]]

![[Link target#First heading]]

![[Kitchen floor plan.svg]]

![plan](../../Notes/Kitchen%20floor%20plan.svg)

![[Nowhere.png]]

## In a table

| Link | Why |
| --- | --- |
| [[Link target\|in a table]] | an escaped pipe before the alias |
