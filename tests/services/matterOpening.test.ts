import { describe, expect, it } from 'vitest';
import { matterOpenDecision, type OpenContext } from '../../src/services/matterOpening';

const ctx = (over: Partial<OpenContext> = {}): OpenContext => ({
	enabled: true,
	isMatter: (p) => p.startsWith('MTM/Matters/'),
	notePath: null,
	...over,
});
const kitchen = 'MTM/Matters/Kitchen renovation.md';

describe('matterOpenDecision', () => {
	it('shows a Matter note as its overview', () => {
		expect(matterOpenDecision('markdown', kitchen, ctx())).toEqual({ overview: kitchen, keepNote: false });
	});

	it('lets other notes and other views through', () => {
		expect(matterOpenDecision('markdown', 'Notes/Plan.md', ctx())).toEqual({ overview: null, keepNote: false });
		expect(matterOpenDecision('bases', 'MTM/Boards/Matters.base', ctx())).toEqual({ overview: null, keepNote: false });
		expect(matterOpenDecision('empty', undefined, ctx())).toEqual({ overview: null, keepNote: false });
	});

	it('keeps the note in a tab asked to show it as a note, also when it switches mode', () => {
		expect(matterOpenDecision('markdown', kitchen, ctx({ notePath: kitchen }))).toEqual({ overview: null, keepNote: true });
	});

	it('ends note mode when the tab shows something else, so the Matter opens as its overview there next time', () => {
		expect(matterOpenDecision('markdown', 'Notes/Plan.md', ctx({ notePath: kitchen })).keepNote).toBe(false);
		expect(matterOpenDecision('mtm-matter-overview', undefined, ctx({ notePath: kitchen })).keepNote).toBe(false);
		expect(matterOpenDecision('markdown', 'MTM/Matters/Garden.md', ctx({ notePath: kitchen }))).toEqual({ overview: 'MTM/Matters/Garden.md', keepNote: false });
	});

	it('does nothing when the setting is off', () => {
		expect(matterOpenDecision('markdown', kitchen, ctx({ enabled: false }))).toEqual({ overview: null, keepNote: false });
	});
});
