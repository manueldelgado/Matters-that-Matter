import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { effectiveAction, fallbackWrites, isAbsent, isOrphan, linkText, type ResolveLink } from '../../src/services/effective';

const settings = DEFAULT_SETTINGS;
const notes: Record<string, { path: string; isMatter: boolean }> = {
	Kitchen: { path: 'MTM/Matters/Kitchen.md', isMatter: true },
	Inbox: { path: 'MTM/Matters/Inbox.md', isMatter: false },
	'Marco Rossi': { path: 'MTM/People/Marco Rossi.md', isMatter: false },
};
const resolve: ResolveLink = (text) => notes[text] ?? null;

describe('linkText', () => {
	it('reads wikilinks, with aliases, headings and blocks', () => {
		expect(linkText('[[Kitchen]]')).toBe('Kitchen');
		expect(linkText('[[Kitchen|The kitchen]]')).toBe('Kitchen');
		expect(linkText('[[Kitchen#Plan]]')).toBe('Kitchen');
		expect(linkText('[[MTM/Matters/Kitchen^abc]]')).toBe('MTM/Matters/Kitchen');
	});

	it('accepts plain text as link text', () => {
		expect(linkText(' Kitchen ')).toBe('Kitchen');
	});

	it('rejects lists, numbers and empty links', () => {
		expect(linkText(['[[Kitchen]]'])).toBeNull();
		expect(linkText(3)).toBeNull();
		expect(linkText('[[]]')).toBeNull();
	});
});

describe('isAbsent', () => {
	it('treats undefined, null and blank strings as absent', () => {
		expect([undefined, null, '', '  '].every(isAbsent)).toBe(true);
		expect([0, false, 'x', []].some(isAbsent)).toBe(false);
	});
});

describe('effectiveAction', () => {
	it('uses valid values as they are', () => {
		const a = effectiveAction({ 'mtm-status': 'doing', 'mtm-type': 'call', 'mtm-matter': '[[Kitchen]]' }, settings, resolve);
		expect(a.status.id).toBe('doing');
		expect(a.category).toBe('active');
		expect(a.type.id).toBe('call');
		expect(a.matterPath).toBe('MTM/Matters/Kitchen.md');
		expect(isOrphan(a)).toBe(false);
	});

	it('falls back silently for absent values', () => {
		const a = effectiveAction({ 'mtm-status': '', 'mtm-matter': null }, settings, resolve);
		expect(a.status.id).toBe('later');
		expect(a.type.id).toBe('write');
		expect(a.matterPath).toBe(settings.inboxPath);
		expect(a.orphans).toEqual({});
		expect(effectiveAction(undefined, settings, resolve).orphans).toEqual({});
	});

	it('falls back with orphan badges for invalid values, keeping the raw value', () => {
		const a = effectiveAction({ 'mtm-status': 'Someday', 'mtm-type': 'fax', 'mtm-matter': '[[Garden]]' }, settings, resolve);
		expect(a.status.id).toBe('later');
		expect(a.type.id).toBe('write');
		expect(a.matterPath).toBe(settings.inboxPath);
		expect(a.orphans).toEqual({ status: 'Someday', type: 'fax', matter: '[[Garden]]' });
	});

	it('treats a status label as invalid: notes store IDs', () => {
		expect(effectiveAction({ 'mtm-status': 'Next' }, settings, resolve).orphans.status).toBe('Next');
	});

	it('treats a link to a note that is not a Matter as invalid', () => {
		expect(effectiveAction({ 'mtm-matter': '[[Marco Rossi]]' }, settings, resolve).orphans.matter).toBe('[[Marco Rossi]]');
	});

	it('accepts the Inbox by its path even without mtm-kind', () => {
		const a = effectiveAction({ 'mtm-matter': '[[Inbox]]' }, settings, resolve);
		expect(a.matterPath).toBe(settings.inboxPath);
		expect(a.orphans).toEqual({});
	});

	it('shows non-string raw values as text', () => {
		const a = effectiveAction({ 'mtm-status': 3, 'mtm-matter': ['[[Kitchen]]'] }, settings, resolve);
		expect(a.orphans).toEqual({ status: '3', matter: '["[[Kitchen]]"]' });
	});

	it('becomes valid again when a missing status is re-created with the same ID', () => {
		const fm = { 'mtm-status': 'someday' };
		expect(isOrphan(effectiveAction(fm, settings, resolve))).toBe(true);
		const withSomeday = { ...settings, statuses: [...settings.statuses, { id: 'someday', label: 'Someday', tone: 'ink' as const, category: 'open' as const }] };
		expect(isOrphan(effectiveAction(fm, withSomeday, resolve))).toBe(false);
	});

	it('falls back to the first status or type if a flag is missing', () => {
		const noFlags = { ...settings, statuses: settings.statuses.map((s) => ({ ...s, backlog: false })), types: settings.types.map((t) => ({ ...t, default: false })) };
		const a = effectiveAction({}, noFlags, resolve);
		expect(a.status.id).toBe('later');
		expect(a.type.id).toBe('call');
	});
});

describe('fallbackWrites', () => {
	it('writes fallbacks for invalid fields only', () => {
		const a = effectiveAction({ 'mtm-status': 'Someday', 'mtm-type': 'call', 'mtm-matter': '[[Garden]]' }, settings, resolve);
		expect(fallbackWrites(a)).toEqual({ status: 'later', matterToInbox: true });
	});

	it('writes nothing for a valid Action', () => {
		expect(fallbackWrites(effectiveAction({}, settings, resolve))).toEqual({});
	});
});
