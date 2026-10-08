import { describe, expect, it } from 'vitest';
import { checklistItems, getDetails, insertTask, parseTask, setDetails, setTaskChecked, splitFrontmatter, taskLines, toggleTask } from '../../src/model/body';

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
		expect(note).toBe(`${fm}Notes\n- abc\n\n- [ ] Step\n`);
		prev = 'Plain.';
		note = `${fm}Plain.\n`;
		for (const typed of ['Plain.\n## Heading', 'Plain.\n## Heading two']) {
			note = setDetails(note, typed, prev);
			prev = typed;
		}
		expect(note).toBe(`${fm}Plain.\n## Heading two\n`);
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
