import { describe, expect, it } from 'vitest';
import { pathAfterRename, pathSettingsAfterRename } from '../../src/services/renames';

const settings = {
	inboxPath: 'MTM/Matters/Inbox.md',
	boardPath: 'MTM/Boards/Matters.base',
	folders: { matters: 'MTM/Matters', actions: 'MTM/Actions', boards: 'MTM/Boards', people: 'People' },
};

describe('pathAfterRename', () => {
	it('moves the item itself and anything inside it', () => {
		expect(pathAfterRename('MTM/Matters/Inbox.md', 'MTM/Matters/Inbox.md', 'MTM/Matters/Capture.md')).toBe('MTM/Matters/Capture.md');
		expect(pathAfterRename('MTM/Matters/Inbox.md', 'MTM', 'Work')).toBe('Work/Matters/Inbox.md');
		expect(pathAfterRename('MTM/Matters', 'MTM/Matters', 'MTM/Lines')).toBe('MTM/Lines');
	});

	it('leaves other paths alone, including names that only start the same', () => {
		expect(pathAfterRename('MTM/Matters/Inbox.md', 'MTM/Matters/Other.md', 'x.md')).toBeNull();
		expect(pathAfterRename('MTM/Matters/Inbox.md', 'MTM/Mat', 'X')).toBeNull();
		expect(pathAfterRename('MTM2/Actions', 'MTM', 'Work')).toBeNull();
	});
});

describe('pathSettingsAfterRename', () => {
	it('follows a rename of the Inbox or the board', () => {
		expect(pathSettingsAfterRename(settings, 'MTM/Matters/Inbox.md', 'MTM/Matters/Capture.md')).toEqual({ ...settings, inboxPath: 'MTM/Matters/Capture.md' });
		expect(pathSettingsAfterRename(settings, 'MTM/Boards/Matters.base', 'MTM/Boards/Home.base')?.boardPath).toBe('MTM/Boards/Home.base');
	});

	it('follows a renamed folder holding the Inbox, the board and the folders', () => {
		expect(pathSettingsAfterRename(settings, 'MTM', 'Work')).toEqual({
			inboxPath: 'Work/Matters/Inbox.md',
			boardPath: 'Work/Boards/Matters.base',
			folders: { matters: 'Work/Matters', actions: 'Work/Actions', boards: 'Work/Boards', people: 'People' },
		});
		expect(pathSettingsAfterRename(settings, 'MTM/Actions', 'MTM/Tasks')).toEqual({ ...settings, folders: { ...settings.folders, actions: 'MTM/Tasks' } });
	});

	it('finds nothing to change for the files of a folder already followed, or for other files', () => {
		const after = pathSettingsAfterRename(settings, 'MTM', 'Work');
		expect(after && pathSettingsAfterRename(after, 'MTM/Matters/Inbox.md', 'Work/Matters/Inbox.md')).toBeNull();
		expect(pathSettingsAfterRename(settings, 'Notes/a.md', 'Notes/b.md')).toBeNull();
	});

	it('does not change the settings it is given', () => {
		const copy = structuredClone(settings);
		pathSettingsAfterRename(settings, 'MTM', 'Work');
		expect(settings).toEqual(copy);
	});
});
