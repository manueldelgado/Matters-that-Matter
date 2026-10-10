import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { toActionItem } from '../../src/services/actionItems';
import { chipModel, chipSignature, findLinks } from '../../src/services/inlineChip';

const resolve = () => null;
const item = (title: string, fm: Record<string, unknown>) =>
	toActionItem(`MTM/Actions/${title}.md`, title, { 'mtm-kind': 'action', 'mtm-status': 'next', ...fm }, DEFAULT_SETTINGS, resolve);

describe('chipModel', () => {
	it('shows the type, title and due date of an open Action', () => {
		const m = chipModel(item('Confirm the worktop measurements', { 'mtm-type': 'call', 'mtm-due': '2026-10-09T10:00' }));
		expect(m).toEqual({
			path: 'MTM/Actions/Confirm the worktop measurements.md',
			title: 'Confirm the worktop measurements',
			typeId: 'call',
			tone: 'mint',
			icon: 'phone',
			done: false,
			due: { date: '2026-10-09', time: '10:00' },
		});
	});

	it('drops the date of a closed Action', () => {
		const m = chipModel(item('Pick up paint samples', { 'mtm-type': 'buy', 'mtm-status': 'done', 'mtm-due': '2026-10-01' }));
		expect(m.done).toBe(true);
		expect(m.due).toBeNull();
	});

	it('shows the default type for an unknown one, without a badge', () => {
		const m = chipModel(item('Odd', { 'mtm-type': 'nope' }));
		expect([m.typeId, m.icon]).toEqual(['write', 'pencil-line']);
	});

	it('changes signature with what the chip shows, and with the day only when dated', () => {
		const open = chipModel(item('A', { 'mtm-type': 'call', 'mtm-due': '2026-10-09' }));
		const undated = chipModel(item('B', { 'mtm-type': 'call' }));
		expect(chipSignature(open, '2026-10-09')).not.toBe(chipSignature(open, '2026-10-10'));
		expect(chipSignature(undated, '2026-10-09')).toBe(chipSignature(undated, '2026-10-10'));
		expect(chipSignature(open, '2026-10-09')).not.toBe(chipSignature({ ...open, done: true }, '2026-10-09'));
	});
});

describe('findLinks', () => {
	it('finds wikilinks, with or without an alias', () => {
		const text = 'Need to [[Confirm the worktop measurements]] and [[Meet Alice to plan chapter 4|the planning session]].';
		expect(findLinks(text)).toEqual([
			{ from: 8, to: 44, linktext: 'Confirm the worktop measurements', display: 'Confirm the worktop measurements', hasAlias: false },
			{ from: 49, to: 102, linktext: 'Meet Alice to plan chapter 4', display: 'the planning session', hasAlias: true },
		]);
		expect(text.slice(8, 44)).toBe('[[Confirm the worktop measurements]]');
	});

	it('shows headings and blocks the way Obsidian does', () => {
		expect(findLinks('[[Order the worktop#Notes]]')[0]?.display).toBe('Order the worktop > Notes');
	});

	it('finds internal Markdown links, decoded, and skips external ones', () => {
		const links = findLinks('See [the order](Order%20the%20worktop.md), [docs](https://example.com) and [x](<Some note.md>).');
		expect(links.map((l) => [l.linktext, l.display, l.hasAlias])).toEqual([
			['Order the worktop.md', 'the order', true],
			['Some note.md', 'x', true],
		]);
	});

	it('leaves embeds alone', () => {
		expect(findLinks('![[Kitchen floor plan.svg]] and ![plan](plan.png)')).toEqual([]);
	});

	it('ignores empty links', () => {
		expect(findLinks('[[ ]] and [[|alias]]')).toEqual([]);
	});
});
