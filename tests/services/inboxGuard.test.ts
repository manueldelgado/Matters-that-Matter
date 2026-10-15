import { describe, expect, it } from 'vitest';
import { inboxRepairs, isInboxDuplicate, isInboxLikeName, renamedInbox } from '../../src/services/inboxGuard';

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
	it('finds the Inbox renamed elsewhere among the notes created while it was missing', () => {
		const inbox = { 'mtm-kind': 'matter', 'mtm-icon': 'inbox', 'mtm-state': 'active' };
		const other = { 'mtm-kind': 'matter', 'mtm-icon': 'house' };
		expect(renamedInbox([{ path: 'a.md', fm: other }, { path: 'MTM/Matters/Capture.md', fm: inbox }])).toBe('MTM/Matters/Capture.md');
		expect(renamedInbox([{ path: 'a.md', fm: other }, { path: 'b.md', fm: null }])).toBeNull();
		expect(renamedInbox([{ path: 'a.md', fm: inbox }, { path: 'b.md', fm: inbox }])).toBeNull();
		expect(renamedInbox([{ path: 'a.md', fm: { 'mtm-kind': 'action', 'mtm-icon': 'inbox' } }])).toBeNull();
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

describe('isInboxLikeName', () => {
	const inbox = 'MTM/Matters/Inbox.md';
	const folder = 'MTM/Matters';

	it.each(['Inbox', 'inbox', '  INBOX ', 'Inbox?', 'Inbox 2', 'inbox 12'])('refuses %j beside the Inbox', (name) => {
		expect(isInboxLikeName(name, folder, inbox)).toBe(true);
	});

	it.each(['Inbox zero', 'My inbox', 'Inbox 2 b', 'Inbox2', '', '   '])('accepts %j', (name) => {
		expect(isInboxLikeName(name, folder, inbox)).toBe(false);
	});

	it('refuses the Inbox’s own name in any folder, a numbered copy only beside it', () => {
		expect(isInboxLikeName('Inbox', 'Elsewhere', inbox)).toBe(true);
		expect(isInboxLikeName('Inbox 2', 'Elsewhere', inbox)).toBe(false);
	});

	it('follows a renamed Inbox', () => {
		expect(isInboxLikeName('Inbox', folder, 'MTM/Matters/Capture.md')).toBe(false);
		expect(isInboxLikeName('capture', folder, 'MTM/Matters/Capture.md')).toBe(true);
		expect(isInboxLikeName('Capture 3', folder, 'MTM/Matters/Capture.md')).toBe(true);
	});

	it('reads the folder as Obsidian writes it, the vault’s root too', () => {
		expect(isInboxLikeName('Inbox 2', '/MTM/Matters/', inbox)).toBe(true);
		expect(isInboxLikeName('Inbox 2', '/', 'Inbox.md')).toBe(true);
		expect(isInboxLikeName('Inbox 2', '', 'Inbox.md')).toBe(true);
	});
});
