// Chips in Live Preview: links to Actions in the visible lines become chips, except where the cursor or a selection
// touches them (the raw link shows, as Obsidian does). Links are found in the text; the syntax tree, whose node names
// are Obsidian's own and undocumented, only keeps code, math, comments and front matter out. Source mode is untouched.

import { Keymap, editorInfoField, editorLivePreviewField } from 'obsidian';
import { syntaxTree } from '@codemirror/language';
import { Prec, RangeSetBuilder, StateEffect, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { toYmd } from '../../model/dates';
import { chipSignature, findLinks, type ChipModel } from '../../services/inlineChip';
import { fillChip } from '../../ui/components/inlineChip';
import type { InlineChips } from './inlineChips';

/** Redraw the chips: an Action or the settings changed. */
export const refreshChips = StateEffect.define<null>();

/** Nodes whose links stay as they are. */
const NOT_PROSE = /code|math|comment|frontmatter/i;

class ChipWidget extends WidgetType {
	constructor(
		private host: InlineChips,
		private model: ChipModel,
		private text: string,
		private linktext: string,
		private sourcePath: string,
		private hoverParent: unknown,
		private signature: string,
	) {
		super();
	}

	eq(other: ChipWidget): boolean {
		return other.signature === this.signature;
	}

	toDOM(): HTMLElement {
		const chip = createSpan();
		const link = chip.createSpan({ cls: 'cm-hmd-internal-link', text: this.text });
		fillChip(chip, link, this.model, new Date(), this.text);
		// Click opens like a link; the editor neither moves the cursor in nor selects.
		chip.addEventListener('mousedown', (e) => e.preventDefault());
		chip.addEventListener('click', (e) => {
			e.preventDefault();
			this.host.open(this.linktext, this.sourcePath, Keymap.isModEvent(e));
		});
		chip.addEventListener('mouseover', (e) => this.host.hover(e, chip, this.linktext, this.sourcePath, this.hoverParent));
		return chip;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

function inProse(state: EditorState, pos: number): boolean {
	try {
		for (let node: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent as typeof node) {
			if (NOT_PROSE.test(node.name)) return false;
		}
	} catch {
		// No tree: treat the line as prose.
	}
	return true;
}

function build(view: EditorView, host: InlineChips): DecorationSet {
	const { state } = view;
	if (!host.isOn() || !state.field(editorLivePreviewField, false)) return Decoration.none;
	const info = state.field(editorInfoField, false);
	const sourcePath = info?.file?.path ?? '';
	const hoverParent = info && 'hoverPopover' in info ? info : { hoverPopover: null };
	const today = toYmd(new Date());
	const builder = new RangeSetBuilder<Decoration>();
	let last = -1;
	for (const { from, to } of view.visibleRanges) {
		for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) {
			const line = state.doc.line(n);
			if (line.from <= last) continue;
			last = line.from;
			for (const link of findLinks(line.text)) {
				const start = line.from + link.from;
				const end = line.from + link.to;
				// The cursor or a selection touching the link: show it raw.
				if (state.selection.ranges.some((r) => r.from <= end && r.to >= start)) continue;
				if (!inProse(state, start + 1)) continue;
				const model = host.modelFor(link.linktext, sourcePath);
				if (!model) continue;
				const signature = `${chipSignature(model, today)}|${link.display}|${link.linktext}|${sourcePath}`;
				const widget = new ChipWidget(host, model, link.display, link.linktext, sourcePath, hoverParent, signature);
				builder.add(start, end, Decoration.replace({ widget }));
			}
		}
	}
	return builder.finish();
}

export function livePreviewChips(host: InlineChips) {
	// Above Obsidian's own link decorations (which hide the brackets), or theirs win and the chip is dropped.
	return Prec.highest(ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(private view: EditorView) {
				host.editors.add(view);
				this.decorations = build(view, host);
			}
			update(u: ViewUpdate) {
				const asked = u.transactions.some((t) => t.effects.some((e) => e.is(refreshChips)));
				const mode = u.startState.field(editorLivePreviewField, false) !== u.state.field(editorLivePreviewField, false);
				if (asked || mode || u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = build(u.view, host);
			}
			destroy() {
				host.editors.delete(this.view);
			}
		},
		{ decorations: (v) => v.decorations },
	));
}
