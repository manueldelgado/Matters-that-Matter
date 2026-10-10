import { describe, expect, it } from 'vitest';
import { withBody } from '../../src/services/planContent';

describe('a new note: the body after the frontmatter', () => {
	it.each([
		['frontmatter with a final line break', '---\nmtm-kind: action\n---\n', 'Details\n', '---\nmtm-kind: action\n---\nDetails\n'],
		['frontmatter without one', '---\nmtm-kind: action\n---', 'Details\n', '---\nmtm-kind: action\n---\nDetails\n'],
		['no body', '---\nmtm-kind: action\n---\n', '', '---\nmtm-kind: action\n---\n'],
		['no frontmatter', '', 'Details\n', 'Details\n'],
		['a body that starts with dashes stays body', '---\na: 1\n---\n', '---\nb: 2\n---\n', '---\na: 1\n---\n---\nb: 2\n---\n'],
	])('%s', (_name, content, body, expected) => {
		expect(withBody(content, body)).toBe(expected);
	});
});
