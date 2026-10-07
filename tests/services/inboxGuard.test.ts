import { describe, expect, it } from 'vitest';
import { inboxPathAfterRename, inboxRepairs, isInboxDuplicate } from '../../src/services/inboxGuard';

describe('inboxRepairs', () => {
	it('needs nothing for a healthy Inbox', () => {
		expect(inboxRepairs({ 'mtm-kind': 'matter', 'mtm-state': 'active' })).toEqual({});
		expect(inboxRepairs({ 'mtm-kind': 'matter' })).toEqual({});
	});

	it('restores a removed mtm-kind', () => {
		expect(inboxRepairs({ 'mtm-state': 'active' })).toEqual({ 'mtm-kind': 'matter' });
		expect(inboxRepairs(null)).toEqual({ 'mtm-kind': 'matter' });
	});

	it('reverts a hand-edited state', () => {
		expect(inboxRepairs({ 'mtm-kind': 'matter', 'mtm-state': 'closed' })).toEqual({ 'mtm-state': 'active' });
		expect(inboxRepairs({ 'mtm-kind': 'matter', 'mtm-state': 'dormant' })).toEqual({ 'mtm-state': 'active' });
	});
});

describe('Inbox paths', () => {
	it('follows a rename of the Inbox only', () => {
		expect(inboxPathAfterRename('MTM/Matters/Inbox.md', 'MTM/Matters/Capture.md', 'MTM/Matters/Inbox.md')).toBe('MTM/Matters/Capture.md');
		expect(inboxPathAfterRename('MTM/Matters/Other.md', 'x.md', 'MTM/Matters/Inbox.md')).toBeNull();
	});

	it('detects numbered duplicates next to the Inbox', () => {
		const inbox = 'MTM/Matters/Inbox.md';
		expect(isInboxDuplicate('MTM/Matters/Inbox 1.md', inbox)).toBe(true);
		expect(isInboxDuplicate('MTM/Matters/Inbox 12.md', inbox)).toBe(true);
		expect(isInboxDuplicate('MTM/Matters/Inbox.md', inbox)).toBe(false);
		expect(isInboxDuplicate('MTM/Matters/Inbox zero.md', inbox)).toBe(false);
		expect(isInboxDuplicate('Elsewhere/Inbox 1.md', inbox)).toBe(false);
		expect(isInboxDuplicate('Inbox (1) 1.md', 'Inbox (1).md')).toBe(true);
	});
});
