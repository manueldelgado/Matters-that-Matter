import { describe, expect, it } from 'vitest';
import { today } from '../../src/ops/today';
import type { OpResult } from '../../src/ops/types';
import { vaultView } from '../../src/ops/vaultView';
import { todayModel } from '../../src/services/todayModel';
import { toActionItem } from '../../src/services/actionItems';
import { matterList } from '../../src/services/notesModel';
import { NOW, vault } from './snapshot';

function ok<T>(r: OpResult<T>) {
	if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
	return r;
}

describe('the vault as the operations read it', () => {
	it('builds Actions and Matters as the plugin’s index does', () => {
		const s = vault();
		const view = vaultView(s);
		const resolve = (from: string) => (text: string) => {
			const path = s.resolve(text, from);
			return path ? { path, isMatter: s.notes.find((n) => n.path === path)?.frontmatter?.['mtm-kind'] === 'matter' } : null;
		};
		const actions = s.notes.filter((n) => n.frontmatter?.['mtm-kind'] === 'action');
		const items = actions.map((n) => toActionItem(n.path, n.basename, n.frontmatter, s.settings, resolve(n.path)));
		expect(view.actions.map((a) => ({ ...a.item, linkedCount: 0 }))).toEqual(items);
		// Only the worktop note links to another note that is neither its Matter nor one of its people.
		expect(view.actions.filter((a) => a.item.linkedCount > 0).map((a) => [a.item.title, a.item.linkedCount])).toEqual([['Confirm the worktop measurements', 2]]);
		const matterNotes = s.notes.filter((n) => n.frontmatter?.['mtm-kind'] === 'matter');
		const inbox = s.notes.find((n) => n.path === s.settings.inboxPath) ?? null;
		expect(view.matters).toEqual(matterList(matterNotes, inbox, s.settings, '2026-10-09'));
		expect(view.matters.filter((m) => m.isInbox).map((m) => m.path)).toEqual(['MTM/Matters/Inbox.md']);
		expect(view.people.map((p) => p.path)).toEqual(['MTM/People/Marco Rossi.md', 'MTM/People/Lucía Pérez.md', 'Notes/Some note.md', 'Notes/Read later.md']);
	});
});

describe('today', () => {
	it.each([
		['at noon', NOW],
		['early in the morning', new Date(2026, 9, 9, 8, 0)],
		['a week later', new Date(2026, 9, 16, 12, 0)],
	])('equals what the new tab panel shows, %s', (_, now) => {
		const s = vault({}, { now });
		const view = vaultView(s);
		const model = todayModel({ items: view.actions.map((a) => a.item), matters: view.matters, statuses: s.settings.statuses, inboxPath: s.settings.inboxPath, now });
		const value = ok(today(s)).value;
		expect(value.due.map((a) => a.path)).toEqual(model.due.map((i) => i.path));
		expect(value.next.map((a) => a.path)).toEqual(model.next.map((i) => i.path));
		expect(value.waiting.map((a) => a.path)).toEqual(model.waiting.map((i) => i.path));
		expect(value.reviews.map((m) => m.path)).toEqual(model.reviews.map((m) => m.path));
		expect([value.dueToday, value.late, value.inbox, value.longWaits]).toEqual([model.dueToday, model.late, model.inbox, model.longWaits]);
		expect(value.nextStatus?.id ?? null).toBe(model.nextStatus?.id ?? null);
	});

	it('on Friday 9 October at noon', () => {
		const value = ok(today(vault())).value;
		expect(value.date).toBe('2026-10-09');
		expect(value.due.map((a) => a.title)).toEqual(['Confirm the worktop measurements', 'Pay the council tax']);
		expect([value.dueToday, value.late]).toEqual([0, 2]);
		expect(value.next).toEqual([]);
		expect(value.inbox).toBe(3);
		expect(value.reviews.map((m) => m.name)).toEqual(['Kitchen renovation']);
		expect(value.waiting.map((a) => a.title)).toEqual(['Revised quote from Marco']);
		expect(value.longWaits).toBe(1);
	});

	it('with nothing due: the next step status and its Actions', () => {
		const value = ok(today(vault({}, { now: new Date(2026, 9, 1, 12, 0) }))).value;
		expect(value.due).toEqual([]);
		expect(value.nextStatus).toEqual({ id: 'next', label: 'Next' });
		expect(value.next.map((a) => a.title)).toEqual(['Confirm the worktop measurements', 'Pay the council tax', 'Call Marco about the quote']);
	});
});
