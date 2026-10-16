import { describe, expect, it } from 'vitest';
import {
	appendLine,
	appendReviewNote,
	checklistItems,
	cleanReviewNote,
	latestReviewNote,
	parseReviewNote,
	replaceReviewNote,
	REVIEW_NOTE_MAX,
	reviewNoteLine,
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

	it('reads the block as Obsidian does: after a byte-order mark, empty, or closed by a line with trailing spaces', () => {
		expect(splitFrontmatter(`\uFEFF${fm}Body`)).toEqual({ frontmatter: `\uFEFF${fm}`, body: 'Body' });
		expect(splitFrontmatter('---\n---\nBody')).toEqual({ frontmatter: '---\n---\n', body: 'Body' });
		expect(splitFrontmatter('---\n---\nIntro\n\n---\n\nmore')).toEqual({ frontmatter: '---\n---\n', body: 'Intro\n\n---\n\nmore' });
		expect(splitFrontmatter('---\na: 1\n--- \t\nBody').body).toBe('Body');
		// An opening line with spaces after the dashes is no block to Obsidian.
		expect(splitFrontmatter('---  \na: 1\n---\nBody').frontmatter).toBe('');
	});

	it('keeps the properties of a note that starts with a byte-order mark when its details change', () => {
		const note = `\uFEFF${fm}Old details.\n\n- [ ] a\n`;
		expect(getDetails(note)).toBe('Old details.');
		expect(setDetails(note, 'New details')).toBe(`\uFEFF${fm}New details\n\n- [ ] a\n`);
		expect(insertTask(note, 'b')).toBe(`\uFEFF${fm}Old details.\n\n- [ ] a\n- [ ] b\n`);
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

	it('adds at the indentation of the top-level task items, after the last one\'s sub-items', () => {
		const note = `${fm}- [ ] One\n  - [ ] Sub\n`;
		expect(insertTask(note, 'Two')).toBe(`${fm}- [ ] One\n  - [ ] Sub\n- [ ] Two\n`);
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

describe('review notes', () => {
	const matter = '---\nmtm-kind: matter\nmtm-state: active\n---\n';
	const day = '2026-10-09';

	describe('appending', () => {
		it('writes the line alone in an empty body', () => {
			expect(appendReviewNote(matter, day, 'Chase Marco')).toBe(`${matter}- Reviewed 2026-10-09: Chase Marco\n`);
			expect(appendReviewNote('', day, 'Chase Marco')).toBe('- Reviewed 2026-10-09: Chase Marco\n');
		});

		it('writes after frontmatter without a final newline', () => {
			expect(appendReviewNote('---\nmtm-kind: matter\n---', day, 'Note')).toBe('---\nmtm-kind: matter\n---\n- Reviewed 2026-10-09: Note\n');
		});

		it('leaves a blank line after text, and ends with one newline', () => {
			expect(appendReviewNote(`${matter}Budget agreed.`, day, 'Tiler free')).toBe(`${matter}Budget agreed.\n\n- Reviewed 2026-10-09: Tiler free\n`);
			expect(appendReviewNote(`${matter}Budget agreed.\n\n\n`, day, 'Tiler free')).toBe(`${matter}Budget agreed.\n\n- Reviewed 2026-10-09: Tiler free\n`);
		});

		it('leaves a blank line after a list that is not review notes', () => {
			expect(appendReviewNote(`${matter}Plan:\n- [ ] Quote\n- Tiles\n`, day, 'Note')).toBe(`${matter}Plan:\n- [ ] Quote\n- Tiles\n\n- Reviewed 2026-10-09: Note\n`);
		});

		it('joins earlier review notes without a blank line', () => {
			const before = `${matter}Text\n\n- Reviewed 2026-09-23: Chase Marco\n\n`;
			expect(appendReviewNote(before, day, 'Tiler free')).toBe(`${matter}Text\n\n- Reviewed 2026-09-23: Chase Marco\n- Reviewed 2026-10-09: Tiler free\n`);
		});

		it('keeps CRLF line endings', () => {
			const crlf = '---\r\nmtm-kind: matter\r\n---\r\nBudget agreed.\r\n';
			expect(appendReviewNote(crlf, day, 'Note')).toBe('---\r\nmtm-kind: matter\r\n---\r\nBudget agreed.\r\n\r\n- Reviewed 2026-10-09: Note\r\n');
		});

		it('writes nothing for empty text', () => {
			expect(appendReviewNote(`${matter}Text`, day, '  \n\t ')).toBe(`${matter}Text`);
			expect(reviewNoteLine(day, ' ')).toBeNull();
		});
	});

	describe('the text', () => {
		it('is trimmed, with line breaks and tabs as spaces', () => {
			expect(cleanReviewNote('  Chase Marco\nif nothing\r\nby Friday\tthanks  ')).toBe('Chase Marco if nothing by Friday thanks');
			expect(cleanReviewNote('a \n\n b')).toBe('a b');
		});

		it('puts every kind of line break on one line, so the line written can be found again', () => {
			const odd = 'a\u2028b\u2029c\vd\fe\u0085f';
			expect(cleanReviewNote(odd)).toBe('a b c d e f');
			const line = reviewNoteLine(day, odd) ?? '';
			const once = appendReviewNote(`${matter}Text\n`, day, odd);
			expect(once.split('\n')).toContain(line);
			expect(replaceReviewNote(once, line, day, 'Second')).toBe(`${matter}Text\n\n- Reviewed 2026-10-09: Second\n`);
		});

		it('keeps backticks, links and embeds as typed', () => {
			expect(cleanReviewNote('Ask `Marco` about [[Quote]] and ![[plan.png]]')).toBe('Ask `Marco` about [[Quote]] and ![[plan.png]]');
		});

		it('is capped', () => {
			expect(cleanReviewNote('x'.repeat(400))).toHaveLength(REVIEW_NOTE_MAX);
			expect(Array.from(cleanReviewNote('😀'.repeat(400)))).toHaveLength(REVIEW_NOTE_MAX);
			expect(cleanReviewNote(`${'x'.repeat(299)} y`)).toBe('x'.repeat(299));
		});
	});

	describe('replacing the line written in this step', () => {
		it('replaces it in place', () => {
			const once = appendReviewNote(`${matter}Text\n`, day, 'First');
			expect(replaceReviewNote(once, '- Reviewed 2026-10-09: First', day, 'Second')).toBe(`${matter}Text\n\n- Reviewed 2026-10-09: Second\n`);
		});

		it('leaves an earlier note from the same day alone, even with the same text', () => {
			const earlier = `${matter}Text\n\n- Reviewed 2026-10-09: Same\n`;
			const mine = appendReviewNote(earlier, day, 'Same');
			expect(replaceReviewNote(mine, '- Reviewed 2026-10-09: Same', day, 'Changed')).toBe(
				`${matter}Text\n\n- Reviewed 2026-10-09: Same\n- Reviewed 2026-10-09: Changed\n`,
			);
		});

		it('removes it when the text is emptied', () => {
			const once = appendReviewNote(`${matter}Text\n`, day, 'First');
			expect(replaceReviewNote(once, '- Reviewed 2026-10-09: First', day, '')).toBe(`${matter}Text\n`);
			expect(replaceReviewNote(`${matter}- Reviewed 2026-10-09: First\n`, '- Reviewed 2026-10-09: First', day, '')).toBe(matter);
		});

		it('appends when the line has gone', () => {
			expect(replaceReviewNote(`${matter}Text\n`, '- Reviewed 2026-10-09: First', day, 'Second')).toBe(`${matter}Text\n\n- Reviewed 2026-10-09: Second\n`);
			expect(replaceReviewNote(`${matter}Text\n`, '- Reviewed 2026-10-09: First', day, '')).toBe(`${matter}Text\n`);
		});

		it('keeps CRLF line endings', () => {
			const crlf = '---\r\nmtm-kind: matter\r\n---\r\nText\r\n\r\n- Reviewed 2026-10-09: First\r\n';
			expect(replaceReviewNote(crlf, '- Reviewed 2026-10-09: First', day, 'Second')).toBe('---\r\nmtm-kind: matter\r\n---\r\nText\r\n\r\n- Reviewed 2026-10-09: Second\r\n');
		});
	});

	describe('the latest note', () => {
		it('is the latest by date, wherever it is in the body', () => {
			const content = `${matter}- Reviewed 2026-10-01: Newest\n\nText\n\n- Reviewed 2026-09-23: Older\n`;
			expect(latestReviewNote(content)).toEqual({ date: '2026-10-01', text: 'Newest' });
		});

		it('is the later line on the same day', () => {
			expect(latestReviewNote(`${matter}- Reviewed 2026-10-09: One\n- Reviewed 2026-10-09: Two\n`)).toEqual({ date: day, text: 'Two' });
		});

		it('reads CRLF notes', () => {
			expect(latestReviewNote('---\r\na: 1\r\n---\r\n- Reviewed 2026-10-09: Note\r\n')).toEqual({ date: day, text: 'Note' });
		});

		it('ignores malformed lines', () => {
			for (const line of [
				'- Reviewed 2026-10-9: Short date',
				'- Reviewed 2026-13-01: No such month',
				'- Reviewed 2026-02-30: No such day',
				'- Reviewed 2026-10-09:',
				'- Reviewed 2026-10-09:   ',
				'- Reviewed 2026-10-09 Missing colon',
				'  - Reviewed 2026-10-09: Indented',
				'* Reviewed 2026-10-09: Other bullet',
				'- reviewed 2026-10-09: Lower case',
				'- Reviewed 2026-10-09T10:00: Timed',
			])
				expect(parseReviewNote(line)).toBeNull();
			expect(latestReviewNote(`${matter}- Reviewed 2026-13-01: Bad\n- Reviewed 2026-09-23: Good\n`)).toEqual({ date: '2026-09-23', text: 'Good' });
			expect(latestReviewNote(`${matter}Nothing here\n`)).toBeNull();
		});

		it('never counts lines in code blocks', () => {
			const content = `${matter}- Reviewed 2026-09-23: Real\n\n\`\`\`\n- Reviewed 2026-12-01: In backticks\n\`\`\`\n~~~md\n- Reviewed 2026-11-01: In tildes\n~~~\n`;
			expect(latestReviewNote(content)).toEqual({ date: '2026-09-23', text: 'Real' });
			expect(latestReviewNote(`${matter}\`\`\`\n- Reviewed 2026-12-01: Unclosed\n`)).toBeNull();
		});

		it('never counts lines in the frontmatter', () => {
			const content = '---\nmtm-kind: matter\n- Reviewed 2026-12-01: In frontmatter\n---\n- Reviewed 2026-09-23: In body\n';
			expect(latestReviewNote(content)).toEqual({ date: '2026-09-23', text: 'In body' });
		});
	});
});

describe('a properties block that ends the file without a line break', () => {
	const bare = '---\nmtm-kind: action\n---';

	it('starts the details on a line of their own', () => {
		expect(setDetails(bare, 'Hello')).toBe(`${bare}\nHello\n`);
		expect(setDetails('---\r\nmtm-kind: action\r\n---', 'Hello')).toBe('---\r\nmtm-kind: action\r\n---\r\nHello\r\n');
	});

	it('leaves the note alone when the details stay empty', () => {
		expect(setDetails(bare, '')).toBe(bare);
	});

	it('starts a checklist item on a line of its own', () => {
		expect(insertTask(bare, 'a')).toBe(`${bare}\n- [ ] a\n`);
	});

	it('starts an appended line on a line of its own', () => {
		expect(appendLine(bare, '[[X]]')).toBe(`${bare}\n[[X]]\n`);
	});
});

describe('line endings', () => {
	it('writes typed details with the note\'s own line ending', () => {
		const lf = `${fm}Old\n`;
		expect(setDetails(lf, 'Line one\r\nLine two')).toBe(`${fm}Line one\nLine two\n`);
		expect(setDetails(lf, 'Line one\rLine two')).toBe(`${fm}Line one\nLine two\n`);
		const crlf = fm.replace(/\n/g, '\r\n') + 'Old\r\n';
		expect(setDetails(crlf, 'Line one\r\nLine two')).toBe(`${fm.replace(/\n/g, '\r\n')}Line one\r\nLine two\r\n`);
	});

	it('reads the previous text whatever its line endings', () => {
		const note = `${fm}Notes\n\n- [ ] Step\n`;
		expect(setDetails(note, 'Notes\r\n- [ ] Step', 'Notes\r\n- [ ] Step')).toBe(`${fm}Notes\n\n- [ ] Step\n`);
	});

	it('keeps the line ending of each line it doesn\'t change in a note with mixed endings', () => {
		const mixed = `${fm}Old details\n\n- [ ] a\r\n\r\nMore\n`;
		expect(setDetails(mixed, 'New')).toBe(`${fm}New\n\n- [ ] a\r\n\r\nMore\n`);
		expect(insertTask(mixed, 'b')).toBe(`${fm}Old details\n\n- [ ] a\r\n- [ ] b\n\r\nMore\n`);
		expect(appendLine(mixed, '[[X]]')).toBe(`${fm}Old details\n\n- [ ] a\r\n\r\nMore\n\n[[X]]\n`);
	});

	it('writes new lines with the ending of the note\'s first line', () => {
		const mostlyCrlf = `${fm.replace(/\n/g, '\r\n')}Old\n\n- [ ] a\r\n`;
		expect(insertTask(mostlyCrlf, 'b')).toBe(`${fm.replace(/\n/g, '\r\n')}Old\n\n- [ ] a\r\n- [ ] b\r\n`);
	});
});

describe('task items as Obsidian reads them', () => {
	it('ignores task items inside comments', () => {
		const obsidian = `${fm}- [ ] real\n\n%%\n- [ ] template\n%%\n`;
		expect(taskLines(obsidian)).toEqual([4]);
		expect(insertTask(obsidian, 'new')).toBe(`${fm}- [ ] real\n- [ ] new\n\n%%\n- [ ] template\n%%\n`);
		const html = `${fm}- [ ] real\n\n<!--\n- [ ] template\n-->\n`;
		expect(taskLines(html)).toEqual([4]);
		expect(insertTask(html, 'new')).toBe(`${fm}- [ ] real\n- [ ] new\n\n<!--\n- [ ] template\n-->\n`);
	});

	it('adds after the comment when there is no task outside it', () => {
		const note = `${fm}Text\n\n%%\n- [ ] template\n%%\n`;
		expect(insertTask(note, 'new')).toBe(`${note}\n- [ ] new\n`);
	});

	it('keeps task items in comments within the details', () => {
		const typed = 'Text\n## Heading\n%%\n- [ ] hidden\n%%';
		expect(setDetails(`${fm}Old\n`, typed)).toBe(`${fm}${O}\n${typed}\n${C}\n`);
	});

	it('does not take a link with one character for a task', () => {
		const note = `${fm}- [ ] real\n\nSources:\n- [1](https://x.y) first\n`;
		expect(taskLines(note)).toEqual([4]);
		expect(parseTask('- [1](https://x.y) first')).toBeNull();
		expect(parseTask('- [x]')).toEqual({ checked: true, text: '' });
		expect(insertTask(note, 'new')).toBe(`${fm}- [ ] real\n- [ ] new\n\nSources:\n- [1](https://x.y) first\n`);
	});

	it('adds a new item at the indentation of the top-level task items, after their sub-items', () => {
		expect(insertTask(`${fm}- [ ] parent\n    - [ ] child\n`, 'new')).toBe(`${fm}- [ ] parent\n    - [ ] child\n- [ ] new\n`);
		expect(insertTask(`${fm}- [ ] parent\n\n    - [ ] child\n\nAfter\n`, 'new')).toBe(`${fm}- [ ] parent\n\n    - [ ] child\n- [ ] new\n\nAfter\n`);
		expect(insertTask(`${fm}- Shopping\n  - [ ] eggs\n    - [ ] free range\n  - [ ] milk\n`, 'bread')).toBe(
			`${fm}- Shopping\n  - [ ] eggs\n    - [ ] free range\n  - [ ] milk\n  - [ ] bread\n`,
		);
	});
});
