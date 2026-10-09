import { describe, expect, it } from 'vitest';
import {
	checklistItems,
	DETAILS_CLOSE as C,
	DETAILS_OPEN as O,
	getDetails,
	insertTask,
	parseTask,
	repairDetailsMarkers,
	setDetails,
	setTaskChecked,
	splitFrontmatter,
	taskLines,
	toggleTask,
} from '../../src/model/body';

const fm = '---\nmtm-kind: action\nmtm-status: next\n---\n';

describe('splitFrontmatter', () => {
	it('splits off the frontmatter block', () => {
		expect(splitFrontmatter(`${fm}Body`)).toEqual({ frontmatter: fm, body: 'Body' });
	});

	it('handles notes without frontmatter', () => {
		expect(splitFrontmatter('Just text')).toEqual({ frontmatter: '', body: 'Just text' });
	});

	it('handles CRLF line endings', () => {
		const crlf = '---\r\na: 1\r\n---\r\nBody';
		expect(splitFrontmatter(crlf).body).toBe('Body');
	});
});

describe('details', () => {
	it('end at the first list item', () => {
		expect(getDetails(`${fm}Confirm the measurements.\nTwo lines.\n\n- [ ] Ask\n`)).toBe('Confirm the measurements.\nTwo lines.');
	});

	it('end at a heading, embed or code block', () => {
		expect(getDetails(`${fm}Text\n## Notes\nmore`)).toBe('Text');
		expect(getDetails(`${fm}Text\n![[photo.png]]`)).toBe('Text');
		expect(getDetails(`${fm}Text\n\`\`\`js\ncode\n\`\`\``)).toBe('Text');
		expect(getDetails(`${fm}Text\n1. first`)).toBe('Text');
	});

	it('are empty when the body starts with a block', () => {
		expect(getDetails(`${fm}- [ ] Ask`)).toBe('');
	});

	it('do not end at a hashtag', () => {
		expect(getDetails(`${fm}See #kitchen\nmore`)).toBe('See #kitchen\nmore');
	});

	it('replace only the details', () => {
		const note = `${fm}Old text.\n\n- [ ] Ask\n## Log\n`;
		expect(setDetails(note, 'New text.')).toBe(`${fm}New text.\n\n- [ ] Ask\n## Log\n`);
	});

	it('can be added, and removed', () => {
		expect(setDetails(`${fm}- [ ] Ask\n`, 'Added')).toBe(`${fm}Added\n\n- [ ] Ask\n`);
		expect(setDetails(`${fm}Gone\n\n- [ ] Ask\n`, '  ')).toBe(`${fm}- [ ] Ask\n`);
		expect(setDetails(fm, 'Only text')).toBe(`${fm}Only text\n`);
	});
});

describe('checklist', () => {
	it('finds task lines outside code blocks', () => {
		const note = `${fm}- [ ] One\n- not a task\n\`\`\`\n- [ ] in code\n\`\`\`\n  - [x] Nested`;
		expect(taskLines(note)).toEqual([4, 9]);
	});

	it('adds after the last task item and anything nested under it', () => {
		const note = `${fm}Text\n\n- [ ] One\n- [x] Two\n  More about two\n\n## Log\n`;
		expect(insertTask(note, 'Three')).toBe(`${fm}Text\n\n- [ ] One\n- [x] Two\n  More about two\n- [ ] Three\n\n## Log\n`);
	});

	it('keeps the indentation of the last task item', () => {
		const note = `${fm}- [ ] One\n  - [ ] Sub\n`;
		expect(insertTask(note, 'Sub two')).toBe(`${fm}- [ ] One\n  - [ ] Sub\n  - [ ] Sub two\n`);
	});

	it('adds at the end of the body when there are no tasks', () => {
		expect(insertTask(`${fm}Text\n\n`, 'First')).toBe(`${fm}Text\n\n- [ ] First\n`);
		expect(insertTask(fm, 'First')).toBe(`${fm}- [ ] First\n`);
	});

	it('accepts the last task line from metadataCache', () => {
		const note = `${fm}- [ ] One\n- [ ] Two\n`;
		expect(insertTask(note, 'Between', 4)).toBe(`${fm}- [ ] One\n- [ ] Between\n- [ ] Two\n`);
	});

	it('ticks and unticks tasks', () => {
		const note = `${fm}- [ ] One\n  * [x] Two\n`;
		expect(setTaskChecked(note, 4, true)).toBe(`${fm}- [x] One\n  * [x] Two\n`);
		expect(setTaskChecked(note, 5, false)).toBe(`${fm}- [ ] One\n  * [ ] Two\n`);
		expect(setTaskChecked(note, 0, true)).toBe(note);
	});
});

describe('checklist', () => {
	const note = `${fm}Intro\n\n- [ ] Ask for the quote\n- [x] Measure\n  - [/] Half done\n- plain item\n\`\`\`\n- [ ] in code\n\`\`\`\n`;

	it('parses tasks, treating any mark but a space as checked', () => {
		expect(parseTask('- [ ] Ask')).toEqual({ checked: false, text: 'Ask' });
		expect(parseTask('1. [X] Done')).toEqual({ checked: true, text: 'Done' });
		expect(parseTask('- plain')).toBeNull();
	});

	it('lists the checklist items outside code blocks', () => {
		expect(checklistItems(note)).toEqual([
			{ line: 6, checked: false, text: 'Ask for the quote' },
			{ line: 7, checked: true, text: 'Measure' },
			{ line: 8, checked: true, text: 'Half done' },
		]);
	});

	it('reads only the lines given by the metadata cache', () => {
		expect(checklistItems(note, [7, 9])).toEqual([{ line: 7, checked: true, text: 'Measure' }]);
	});

	it('toggles the item on its line', () => {
		const out = toggleTask(note, 6, 'Ask for the quote', true);
		expect(out.split('\n')[6]).toBe('- [x] Ask for the quote');
		expect(out.split('\n').filter((l, i) => i !== 6)).toEqual(note.split('\n').filter((l, i) => i !== 6));
	});

	it('finds the item by its text when the line is stale', () => {
		const shifted = note.replace('Intro\n', 'Intro\nMore intro\n');
		const out = toggleTask(shifted, 6, 'Ask for the quote', true);
		expect(out.split('\n')[7]).toBe('- [x] Ask for the quote');
	});

	it('leaves the note alone when the item is gone', () => {
		expect(toggleTask(note, 6, 'Something else', true)).toBe(note);
	});
});

describe('setDetails with the previous text', () => {
	const fm = '---\nmtm-kind: action\n---\n';
	it('does not duplicate typed list lines or headings across saves', () => {
		let note = `${fm}\n- [ ] Step\n`;
		let prev = getDetails(note);
		for (const typed of ['Notes\n- a', 'Notes\n- ab', 'Notes\n- abc']) {
			note = setDetails(note, typed, prev);
			prev = typed;
		}
		expect(note).toBe(`${fm}${O}\nNotes\n- abc\n${C}\n\n- [ ] Step\n`);
		prev = 'Plain.';
		note = `${fm}Plain.\n`;
		for (const typed of ['Plain.\n## Heading', 'Plain.\n## Heading two']) {
			note = setDetails(note, typed, prev);
			prev = typed;
		}
		expect(note).toBe(`${fm}${O}\nPlain.\n## Heading two\n${C}\n`);
	});

	it('falls back when the note no longer starts with the previous text', () => {
		const note = `${fm}Changed elsewhere.\n\n- [ ] Step\n`;
		expect(setDetails(note, 'Mine.', 'Old text.')).toBe(`${fm}Mine.\n\n- [ ] Step\n`);
	});

	it('matches whole lines only', () => {
		const note = `${fm}Notes more\n\n- [ ] Step\n`;
		expect(setDetails(note, 'New', 'Notes')).toBe(`${fm}New\n\n- [ ] Step\n`);
	});
});

describe('CRLF notes', () => {
	const crlf = '---\r\nmtm-kind: action\r\n---\r\nDetails.\r\n\r\n- [ ] a\r\n- [ ] b\r\n';
	it('reads the checklist and details', () => {
		expect(checklistItems(crlf).map((i) => i.text)).toEqual(['a', 'b']);
		expect(getDetails(crlf)).toBe('Details.');
	});

	it('keeps CRLF when editing', () => {
		const added = insertTask(crlf, 'c');
		expect(added).toBe('---\r\nmtm-kind: action\r\n---\r\nDetails.\r\n\r\n- [ ] a\r\n- [ ] b\r\n- [ ] c\r\n');
		const ticked = toggleTask(crlf, 6, 'b', true);
		expect(ticked).toContain('- [x] b\r\n');
		const details = setDetails(crlf, 'New\nlines', 'Details.');
		expect(details).toBe('---\r\nmtm-kind: action\r\n---\r\nNew\r\nlines\r\n\r\n- [ ] a\r\n- [ ] b\r\n');
	});
});

describe('details markers', () => {
	const fm = '---\nmtm-kind: action\n---\n';
	const ask = '\n- [ ] Ask for the quote\n';

	describe('typed details that the fallback rule would cut', () => {
		for (const typed of ['Buy for the party:\n- milk\n- bread', 'Plan\n# Ideas\nmore text', '- milk']) {
			it(`round-trip: ${JSON.stringify(typed)}`, () => {
				const note = setDetails(`${fm}Old.\n${ask}`, typed, 'Old.');
				expect(note).toBe(`${fm}${O}\n${typed}\n${C}\n${ask}`);
				expect(getDetails(note)).toBe(typed);
				expect(checklistItems(note).map((i) => i.text)).toEqual(['Ask for the quote']);
			});
		}

		it('are written into a note without a body', () => {
			expect(setDetails(fm, 'A\n- b')).toBe(`${fm}${O}\nA\n- b\n${C}\n`);
		});
	});

	describe('in notes without markers', () => {
		it('are not written when the text does not need them', () => {
			expect(setDetails(`${fm}Old.\n${ask}`, 'New text.\nTwo lines.', 'Old.')).toBe(`${fm}New text.\nTwo lines.\n${ask}`);
		});

		it('leave the note alone on other edits', () => {
			const note = `${fm}Text\n\n- [ ] One\n## Log\n`;
			expect(repairDetailsMarkers(note)).toBe(note);
			expect(insertTask(note, 'Two')).toBe(`${fm}Text\n\n- [ ] One\n- [ ] Two\n## Log\n`);
		});
	});

	describe('once written', () => {
		const note = `${fm}${O}\nBuy:\n- milk\n${C}\n${ask}`;

		it('stay when the text no longer needs them', () => {
			expect(setDetails(note, 'Plain', 'Buy:\n- milk')).toBe(`${fm}${O}\nPlain\n${C}\n${ask}`);
			expect(setDetails(note, '', 'Buy:\n- milk')).toBe(`${fm}${O}\n${C}\n${ask}`);
		});

		it('keep text outside them out of the details, and in the note', () => {
			const outside = `${fm}Before\n${O}\nA\n- b\n${C}\nAfter\n`;
			expect(getDetails(outside)).toBe('A\n- b');
			expect(setDetails(outside, 'New\n- c', 'A\n- b')).toBe(`${fm}Before\n${O}\nNew\n- c\n${C}\nAfter\n`);
		});

		it('are recognised by the token alone, at the start of a line', () => {
			const edited = `${fm}<!-- mtm-details keep me -->\nA\n- b\n<!-- /mtm-details -->\n`;
			expect(getDetails(edited)).toBe('A\n- b');
			expect(getDetails(`${fm}<!-- mtm-detailsx -->\nA\n- b\n`)).toBe('<!-- mtm-detailsx -->\nA');
		});
	});

	describe('task items', () => {
		it('between the markers are checklist items, not details', () => {
			const note = `${fm}${O}\nBuy:\n- [ ] milk\n  for the cake\n- bread\n${C}\n${ask}`;
			expect(getDetails(note)).toBe('Buy:\n- bread');
			expect(checklistItems(note).map((i) => i.text)).toEqual(['milk', 'Ask for the quote']);
		});

		it('between the markers move to just after them on save, in order', () => {
			const note = `${fm}${O}\nBuy:\n- [ ] milk\n  for the cake\n- bread\n- [x] eggs\n${C}\n${ask}`;
			expect(setDetails(note, 'Buy now:\n- bread', 'Buy:\n- bread')).toBe(
				`${fm}${O}\nBuy now:\n- bread\n${C}\n\n- [ ] milk\n  for the cake\n- [x] eggs\n- [ ] Ask for the quote\n`,
			);
		});

		it('typed in the field become checklist items', () => {
			const typed = 'Shop:\n- milk\n- [ ] Call Ana';
			const note = setDetails(`${fm}Notes\n${ask}`, typed, 'Notes');
			expect(note).toBe(`${fm}${O}\nShop:\n- milk\n${C}\n\n- [ ] Call Ana\n- [ ] Ask for the quote\n`);
			expect(getDetails(note)).toBe('Shop:\n- milk');
			// The next save while typing replaces the task it moved instead of adding it again.
			expect(setDetails(note, 'Shop:\n- milk\n- [ ] Call Ana today', typed)).toBe(
				`${fm}${O}\nShop:\n- milk\n${C}\n\n- [ ] Call Ana today\n- [ ] Ask for the quote\n`,
			);
		});

		it('typed in the field need no markers on their own', () => {
			const note = setDetails(`${fm}Notes\n`, 'Notes\n- [ ] Call', 'Notes');
			expect(note).toBe(`${fm}Notes\n\n- [ ] Call\n`);
			expect(getDetails(note)).toBe('Notes');
			expect(setDetails(note, 'Notes\n- [ ] Call Ana', 'Notes\n- [ ] Call')).toBe(`${fm}Notes\n\n- [ ] Call Ana\n`);
		});

		it('moved ahead of text get a blank line after them', () => {
			const note = `${fm}${O}\nA\n- [ ] t\n${C}\nMore text\n`;
			expect(setDetails(note, 'A', 'A')).toBe(`${fm}${O}\nA\n${C}\n\n- [ ] t\n\nMore text\n`);
		});
	});

	describe('damaged', () => {
		const cases: { name: string; note: string; details: string; repaired: string }[] = [
			{
				name: 'opening marker without a closing one',
				note: `${fm}${O}\nBuy:\n- milk\n\n- [ ] Ask\n`,
				details: 'Buy:\n- milk',
				repaired: `${fm}${O}\nBuy:\n- milk\n${C}\n\n- [ ] Ask\n`,
			},
			{
				name: 'opening marker without a closing one, up to a heading',
				note: `${fm}${O}\nPlan\n## Log\n`,
				details: 'Plan',
				repaired: `${fm}${O}\nPlan\n${C}\n## Log\n`,
			},
			{
				name: 'closing marker without an opening one',
				note: `${fm}Buy:\n- milk\n${C}\n\n- [ ] Ask\n`,
				details: 'Buy:\n- milk',
				repaired: `${fm}${O}\nBuy:\n- milk\n${C}\n\n- [ ] Ask\n`,
			},
			{
				name: 'closing marker before the opening one',
				note: `${fm}Intro\n${C}\nmore\n${O}\nlater\n`,
				details: 'Intro',
				repaired: `${fm}${O}\nIntro\n${C}\nmore\nlater\n`,
			},
			{
				name: 'more than one pair',
				note: `${fm}${O}\nA\n- a\n${C}\n\n${O}\nB\n${C}\n`,
				details: 'A\n- a',
				repaired: `${fm}${O}\nA\n- a\n${C}\n\nB\n`,
			},
			{
				name: 'edited marker text',
				note: `${fm}<!-- mtm-details: mine -->\nA\n- a\n<!-- /mtm-details -->\n`,
				details: 'A\n- a',
				repaired: `${fm}${O}\nA\n- a\n${C}\n`,
			},
		];

		for (const c of cases) {
			it(`${c.name}: read tolerantly, repaired on the next body write`, () => {
				expect(getDetails(c.note)).toBe(c.details);
				expect(repairDetailsMarkers(c.note)).toBe(c.repaired);
				expect(setDetails(c.note, c.details, c.details)).toBe(c.repaired);
			});
		}

		it('are repaired when a checklist item is added or ticked', () => {
			const note = `${fm}${O}\nBuy:\n- milk\n\n- [ ] Ask\n`;
			expect(insertTask(note, 'Call')).toBe(`${fm}${O}\nBuy:\n- milk\n${C}\n\n- [ ] Ask\n- [ ] Call\n`);
			expect(toggleTask(note, 7, 'Ask', true)).toBe(`${fm}${O}\nBuy:\n- milk\n${C}\n\n- [x] Ask\n`);
		});

		it('are left alone when nothing is written', () => {
			const note = `${fm}${O}\nBuy:\n- milk\n\n- [ ] Ask\n`;
			expect(toggleTask(note, 7, 'Gone', true)).toBe(note);
		});

		it('get a closing marker when a new item would end the details', () => {
			expect(insertTask(`${fm}${O}\nBuy:\n- milk\n`, 'Call')).toBe(`${fm}${O}\nBuy:\n- milk\n${C}\n\n- [ ] Call\n`);
		});

		it('are not markers when indented or inside a code block', () => {
			const indented = `${fm}Text\n  ${O}\n- a\n`;
			expect(getDetails(indented)).toBe(`Text\n  ${O}`);
			expect(repairDetailsMarkers(indented)).toBe(indented);
			const code = `${fm}Text\n\`\`\`\n${C}\n\`\`\`\n`;
			expect(getDetails(code)).toBe('Text');
			expect(repairDetailsMarkers(code)).toBe(code);
		});
	});

	describe('in CRLF notes', () => {
		const crlf = (s: string) => s.replace(/\n/g, '\r\n');

		it('are read, written and repaired keeping CRLF', () => {
			const note = crlf(`${fm}${O}\nBuy:\n- milk\n${C}\n\n- [ ] Ask\n`);
			expect(getDetails(note)).toBe('Buy:\n- milk');
			expect(setDetails(note, 'Buy:\n- milk\n- bread', 'Buy:\n- milk')).toBe(crlf(`${fm}${O}\nBuy:\n- milk\n- bread\n${C}\n\n- [ ] Ask\n`));
			expect(setDetails(crlf(`${fm}Old\n`), 'A\n- b', 'Old')).toBe(crlf(`${fm}${O}\nA\n- b\n${C}\n`));
			const damaged = crlf(`${fm}${O}\nBuy:\n- milk\n\n- [ ] Ask\n`);
			expect(getDetails(damaged)).toBe('Buy:\n- milk');
			expect(toggleTask(damaged, 7, 'Ask', true)).toBe(crlf(`${fm}${O}\nBuy:\n- milk\n${C}\n\n- [x] Ask\n`));
		});
	});
});
