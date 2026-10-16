import { describe, expect, it } from 'vitest';
import { mergeNote, type MergeInput } from '../../src/files/merge';
import { DETAILS_CLOSE as C, DETAILS_OPEN as O } from '../../src/model/body';

/** A note from property lines and a body. */
const note = (props: string[], body = '') => `---\n${props.join('\n')}\n---\n${body}`;
const BASE = ['mtm-kind: action', 'mtm-type: call', 'mtm-status: next', 'mtm-matter: "[[Kitchen renovation]]"'];
const merge = (base: string | null, ours: string, theirs: string, later: MergeInput['later'] = 'theirs') => mergeNote({ base, ours, theirs, later });
/** The base's property lines with `key: value` set (or removed with undefined), in place or at the end. */
const withProp = (props: string[], key: string, value?: string) => {
	const out = props.filter((p) => !p.startsWith(`${key}:`));
	if (value === undefined) return out;
	const at = props.findIndex((p) => p.startsWith(`${key}:`));
	if (at < 0) return [...out, `${key}: ${value}`];
	out.splice(at, 0, `${key}: ${value}`);
	return out;
};

describe('properties', () => {
	it('a property changed on one side only takes that side’s value', () => {
		const r = merge(note(BASE), note(withProp(BASE, 'mtm-priority', '1')), note(BASE));
		expect(r.content).toBe(note([...BASE, 'mtm-priority: 1']));
		expect(r.decisions).toEqual([]);
	});

	it('different properties changed on each side: both kept', () => {
		const r = merge(note(BASE), note(withProp(BASE, 'mtm-priority', '1')), note(withProp(BASE, 'mtm-due', '2026-10-16')));
		expect(r.content).toContain('mtm-priority: 1');
		expect(r.content).toContain('mtm-due: 2026-10-16');
		expect(r.decisions).toEqual([]);
	});

	it('the same property changed to the same value: that value, no decision', () => {
		const both = note(withProp(BASE, 'mtm-due', '2026-10-16'));
		expect(merge(note(BASE), both, both)).toEqual({ content: both, decisions: [] });
	});

	it('the same property changed to different values: the later one, the other in the decision', () => {
		const ours = note(withProp(BASE, 'mtm-due', '2026-10-16'));
		const theirs = note(withProp(BASE, 'mtm-due', '2026-10-20'));
		const r = merge(note(BASE), ours, theirs, 'theirs');
		expect(r.content).toContain('mtm-due: 2026-10-20');
		expect(r.decisions).toEqual([{ kind: 'property', key: 'mtm-due', kept: '2026-10-20', lost: '2026-10-16' }]);
		expect(merge(note(BASE), ours, theirs, 'ours').content).toContain('mtm-due: 2026-10-16');
	});

	it('a property removed on one side and left on the other is removed', () => {
		const base = note([...BASE, 'mtm-priority: 2']);
		const r = merge(base, note(BASE), base);
		expect(r.content).toBe(note(BASE));
	});

	it('people merge as a set: additions from both, removals from both', () => {
		const people = (...names: string[]) => [...BASE, 'mtm-people:', ...names.map((n) => `  - "[[${n}]]"`)];
		const r = merge(note(people('Marco', 'Lucía')), note(people('Marco', 'Lucía', 'Ana')), note(people('Lucía', 'Pedro')));
		expect(r.content).toBe(note(people('Lucía', 'Pedro', 'Ana')));
		expect(r.decisions).toEqual([]);
	});

	it('the completion date follows the side whose status won', () => {
		const done = note([...withProp(BASE, 'mtm-status', 'done'), 'mtm-completed: 2026-10-09']);
		const moved = note(withProp(BASE, 'mtm-due', '2026-10-20'));
		// Marked done on one device, the due date changed on the other: done, with its date, and the new due date.
		const r = merge(note(BASE), done, moved);
		expect(r.content).toContain('mtm-status: done');
		expect(r.content).toContain('mtm-completed: 2026-10-09');
		expect(r.content).toContain('mtm-due: 2026-10-20');
		expect(r.decisions).toEqual([]);
		// Both changed the status: the later status wins and brings its own completion date (none).
		const doing = note(withProp(BASE, 'mtm-status', 'doing'));
		const later = merge(note(BASE), done, doing, 'theirs');
		expect(later.content).toContain('mtm-status: doing');
		expect(later.content).not.toContain('mtm-completed');
		expect(later.decisions).toEqual([{ kind: 'property', key: 'mtm-status', kept: 'doing', lost: 'done' }]);
	});

	it('waiting since follows waiting on, and the position by hand follows the cell', () => {
		const base = note([...BASE, 'mtm-order: 20']);
		const waiting = note([...BASE, 'mtm-order: 20', 'mtm-waiting-on: "[[Marco]]"', 'mtm-waiting-since: 2026-10-09']);
		const movedOn = note(withProp(BASE, 'mtm-status', 'doing'));
		const r = merge(base, waiting, movedOn);
		expect(r.content).toContain('mtm-waiting-since: 2026-10-09');
		expect(r.content).toContain('mtm-status: doing');
		// The other side moved the card to another column, which removed its position: removed.
		expect(r.content).not.toContain('mtm-order');
	});

	it('keys nobody knows are kept from both sides', () => {
		const r = merge(note(BASE), note([...BASE, 'tags:', '  - home']), note([...BASE, 'rating: 4']));
		expect(r.content).toContain('tags:\n  - home');
		expect(r.content).toContain('rating: 4');
	});

	it('without a base: what both share is kept, and what differs counts as changed on both', () => {
		const r = merge(null, note([...BASE, 'mtm-due: 2026-10-16', 'mtm-priority: 1']), note([...BASE, 'mtm-due: 2026-10-20']), 'theirs');
		expect(r.content).toContain('mtm-due: 2026-10-20');
		expect(r.content).not.toContain('mtm-priority');
		expect(r.decisions.map((d) => d.kind === 'property' && d.key)).toEqual(['mtm-due', 'mtm-priority']);
	});
});

describe('properties added to a note that had none', () => {
	it('a note adopted on one side keeps its properties while the other edits the body', () => {
		const r = merge('Hello\n', '---\nmtm-kind: action\nmtm-id: a1\n---\nHello\n', 'Hello\nmore\n', 'theirs');
		expect(r.content).toBe('---\nmtm-kind: action\nmtm-id: a1\n---\nHello\nmore\n');
		expect(r.decisions).toEqual([]);
	});

	it('two writers giving one note an ID apart: both devices end with the same one, the other recorded', () => {
		const ours = note([...BASE, 'mtm-id: bbb'], 'Text\n');
		const theirs = note([...BASE, 'mtm-id: aaa'], 'Text\n');
		for (const later of ['ours', 'theirs'] as const) {
			const r = merge(note(BASE, 'Text\n'), ours, theirs, later);
			expect(r.content).toContain('mtm-id: aaa');
			expect(r.decisions).toEqual([{ kind: 'property', key: 'mtm-id', kept: 'aaa', lost: 'bbb' }]);
		}
	});
});

describe('the body', () => {
	it('details changed on one side: that side’s text', () => {
		const r = merge(note(BASE, 'Old details.\n'), note(BASE, 'New details.\n'), note(BASE, 'Old details.\n'));
		expect(r.content).toBe(note(BASE, 'New details.\n'));
	});

	it('details changed on both: both kept, the later first, with a decision', () => {
		const r = merge(note(BASE, 'Old details.\n'), note(BASE, 'Ours.\n'), note(BASE, 'Theirs.\n'), 'theirs');
		expect(r.content).toBe(note(BASE, 'Theirs.\n\nOurs.\n'));
		expect(r.decisions).toEqual([{ kind: 'details', kept: 'Theirs.', also: 'Ours.' }]);
	});

	it('a checklist item ticked on one side, another added on the other', () => {
		const base = note(BASE, 'Details.\n\n- [ ] Measure\n- [ ] Order\n');
		const r = merge(base, note(BASE, 'Details.\n\n- [x] Measure\n- [ ] Order\n'), note(BASE, 'Details.\n\n- [ ] Measure\n- [ ] Order\n- [ ] Pay\n'));
		expect(r.content).toBe(note(BASE, 'Details.\n\n- [x] Measure\n- [ ] Order\n- [ ] Pay\n'));
		expect(r.decisions).toEqual([]);
	});

	it('items added on both sides at the end: all of them, the later side’s first', () => {
		const base = note(BASE, '- [ ] Measure\n');
		const r = merge(base, note(BASE, '- [ ] Measure\n- [ ] Ours\n'), note(BASE, '- [ ] Measure\n- [ ] Theirs\n'), 'theirs');
		expect(r.content).toBe(note(BASE, '- [ ] Measure\n- [ ] Theirs\n- [ ] Ours\n'));
		expect(r.decisions).toEqual([]);
	});

	it('an item ticked on one side and renamed on the other: both kept, ticked wins, with a decision', () => {
		const base = note(BASE, '- [ ] Measure\n- [ ] Order\n');
		const r = merge(base, note(BASE, '- [x] Measure\n- [x] Order\n'), note(BASE, '- [ ] Measure\n- [ ] Order the tiles\n'));
		expect(r.content).toBe(note(BASE, '- [x] Measure\n- [ ] Order the tiles\n- [x] Order\n'));
		expect(r.decisions.map((d) => d.kind)).toEqual(['lines']);
	});

	it('an item ticked on one side and removed on the other stays, ticked', () => {
		const base = note(BASE, '- [ ] Measure\n- [ ] Order\n');
		const r = merge(base, note(BASE, '- [ ] Measure\n- [x] Order\n'), note(BASE, '- [ ] Measure\n'));
		expect(r.content).toBe(note(BASE, '- [ ] Measure\n- [x] Order\n'));
	});

	it('a mark only one side changed is that side’s, an untick included', () => {
		const r = merge(note(BASE, '- [x] a\n- [ ] b\n'), note(BASE, '- [ ] a\n- [ ] b\n'), note(BASE, '- [x] a\n- [ ] b2\n'));
		expect(r.content).toBe(note(BASE, '- [ ] a\n- [ ] b2\n'));
	});

	it('marks both sides changed differently: done wins, with a decision', () => {
		const r = merge(note(BASE, '- [ ] a\n- [ ] b\n'), note(BASE, '- [x] a\n- [ ] b\n'), note(BASE, '- [/] a\n- [ ] b2\n'), 'theirs');
		expect(r.content).toBe(note(BASE, '- [x] a\n- [ ] b2\n'));
		expect(r.decisions.map((d) => d.kind)).toEqual(['lines']);
	});

	it('an item added twice on one side stays twice', () => {
		const r = merge(note(BASE, '- [ ] a\n'), note(BASE, '- [ ] a\n- [ ] call\n- [ ] call\n'), note(BASE, '- [ ] a\n- [ ] write\n'), 'theirs');
		expect(r.content).toBe(note(BASE, '- [ ] a\n- [ ] write\n- [ ] call\n- [ ] call\n'));
	});

	it('sub-items added under different parents keep their places', () => {
		const base = note(BASE, '- [ ] A\n- [ ] B\n');
		const r = merge(base, note(BASE, '- [ ] A\n  - [ ] sub1\n- [ ] B\n'), note(BASE, '- [ ] A\n- [ ] B\n  - [ ] sub2\n'));
		expect(r.content).toBe(note(BASE, '- [ ] A\n  - [ ] sub1\n- [ ] B\n  - [ ] sub2\n'));
	});

	it('an item removed on one side and left on the other is removed', () => {
		const base = note(BASE, '- [ ] Measure\n- [ ] Order\n');
		const r = merge(base, note(BASE, '- [ ] Order\n'), base);
		expect(r.content).toBe(note(BASE, '- [ ] Order\n'));
	});

	it('other lines merge line by line; where both changed the same ones, both versions stay, the later first', () => {
		const base = note(BASE, 'Details.\n\n## Notes\nOne\nTwo\nThree\n');
		const one = merge(base, note(BASE, 'Details.\n\n## Notes\nOne!\nTwo\nThree\n'), note(BASE, 'Details.\n\n## Notes\nOne\nTwo\nThree!\n'));
		expect(one.content).toBe(note(BASE, 'Details.\n\n## Notes\nOne!\nTwo\nThree!\n'));
		expect(one.decisions).toEqual([]);
		const both = merge(base, note(BASE, 'Details.\n\n## Notes\nOne\nOurs\nThree\n'), note(BASE, 'Details.\n\n## Notes\nOne\nTheirs\nThree\n'), 'theirs');
		expect(both.content).toBe(note(BASE, 'Details.\n\n## Notes\nOne\nTheirs\n\nOurs\nThree\n'));
		expect(both.decisions).toEqual([{ kind: 'lines', kept: ['Theirs'], also: ['Ours'] }]);
	});

	it('a conflict outside the details says so, and details that merged cleanly say nothing', () => {
		const base = note(BASE, 'L1\nL2\nL3\n\n## H\nx\n');
		const r = merge(base, note(BASE, 'L1!\nL2\nL3\n\n## H\nours\n'), note(BASE, 'L1\nL2\nL3!\n\n## H\ntheirs\n'), 'theirs');
		expect(r.content).toBe(note(BASE, 'L1!\nL2\nL3!\n\n## H\ntheirs\n\nours\n'));
		expect(r.decisions).toEqual([{ kind: 'lines', kept: ['theirs'], also: ['ours'] }]);
	});

	it('a conflict further down whose lines read like the details stays a lines decision', () => {
		const base = note(BASE, 'Intro\n\n## H\nx\n');
		const r = merge(base, note(BASE, 'Intro o\n\n## H\nIntro o\n'), note(BASE, 'Intro t\n\n## H\nIntro t\n'), 'theirs');
		expect(r.decisions.map((d) => d.kind).sort()).toEqual(['details', 'lines']);
	});

	it('details markers from both writers end up as one pair', () => {
		const base = note(BASE, 'Old.\n');
		const ours = note(BASE, `${O}\nOurs\n## not a heading here\n${C}\n`);
		const theirs = note(BASE, `${O}\nTheirs\n${C}\n`);
		const r = merge(base, ours, theirs);
		const markers = r.content.split('\n').filter((l) => l === O || l === C);
		expect(markers).toEqual([O, C]);
		expect(r.content).toContain('Ours');
		expect(r.content).toContain('Theirs');
	});
});

describe('the file', () => {
	it('keeps the base’s line endings and byte-order mark; a side that changed only its endings changed nothing', () => {
		const crlf = (t: string) => `\uFEFF${t.replace(/\n/g, '\r\n')}`;
		const base = crlf(note(BASE, 'Details.\n'));
		const lfOnly = note(BASE, 'Details.\n');
		const r = merge(base, lfOnly, crlf(note(withProp(BASE, 'mtm-priority', '1'), 'Details.\n')));
		expect(r.content).toBe(crlf(note([...BASE, 'mtm-priority: 1'], 'Details.\n')));
		expect(r.decisions).toEqual([]);
	});

	it('properties nobody can read: the whole note merges as lines', () => {
		const base = '---\nmtm-kind: action\nbad: [unclosed\n---\nOne\nTwo\nThree\n';
		const r = merge(base, base.replace('One', 'One!'), base.replace('Three', 'Three!'));
		expect(r.content).toBe('---\nmtm-kind: action\nbad: [unclosed\n---\nOne!\nTwo\nThree!\n');
	});

	it('the same note on both sides is itself', () => {
		const n = note(BASE, 'Details.\n\n- [ ] Measure\n');
		expect(merge(note(BASE), n, n)).toEqual({ content: n, decisions: [] });
		expect(merge(null, n, n)).toEqual({ content: n, decisions: [] });
	});
});
