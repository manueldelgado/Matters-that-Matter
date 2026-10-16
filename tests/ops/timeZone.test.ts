import { describe, expect, it } from 'vitest';
import { addAction } from '../../src/ops/addAction';
import { listActions } from '../../src/ops/listActions';
import { markAsDone } from '../../src/ops/markAsDone';
import { today } from '../../src/ops/today';
import type { OpResult, Snapshot } from '../../src/ops/types';
import { vault } from './snapshot';

function ok<T>(r: OpResult<T>) {
	if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
	return r;
}

// 23:30 on Friday 9 October in UTC: already Saturday in Madrid, still Friday evening in New York.
const INSTANT = new Date(Date.UTC(2026, 9, 9, 23, 30));
const inZone = (timeZone: string): Snapshot => ({ ...vault({}, { now: INSTANT }), timeZone });

describe('the time zone the snapshot names', () => {
	it('decides what today is', () => {
		expect(ok(today(inZone('Europe/Madrid'))).value.date).toBe('2026-10-10');
		expect(ok(today(inZone('America/New_York'))).value.date).toBe('2026-10-09');
	});

	it('decides the completion date written', () => {
		const done = (zone: string) => ok(markAsDone('Call Marco about the quote', inZone(zone))).plan.edits[0]?.set['mtm-completed'];
		expect(done('Europe/Madrid')).toBe('2026-10-10');
		expect(done('America/New_York')).toBe('2026-10-09');
	});

	it('decides what is overdue', () => {
		const due: Snapshot = vault({
			'MTM/Actions/Post the forms.md': { frontmatter: { 'mtm-kind': 'action', 'mtm-type': 'call', 'mtm-status': 'next', 'mtm-matter': '[[Kitchen renovation]]', 'mtm-due': '2026-10-09' } },
		}, { now: INSTANT });
		// Due on Friday, all day: overdue once Saturday has begun where the user is.
		const overdue = (timeZone: string) => ok(listActions({}, { ...due, timeZone })).value.find((a) => a.title === 'Post the forms')?.overdue;
		expect(overdue('Europe/Madrid')).toBe(true);
		expect(overdue('America/New_York')).toBe(false);
	});

	it('decides what quick add reads as tomorrow', () => {
		const due = (zone: string) => ok(addAction({ text: 'Water the plants tomorrow' }, inZone(zone))).plan.creates[0]?.frontmatter.find(([k]) => k === 'mtm-due')?.[1];
		expect(due('Europe/Madrid')).toBe('2026-10-11');
		expect(due('America/New_York')).toBe('2026-10-10');
	});
});
