import { describe, expect, it } from 'vitest';
import { getDetails, insertTask, setDetails, setTaskChecked, splitFrontmatter, taskLines } from '../../src/model/body';

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
