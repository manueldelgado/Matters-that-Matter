import { describe, expect, it } from 'vitest';
import { STRINGS } from '../../src/strings';

const docs = STRINGS.docs;
const urls = [docs.home, docs.connect, ...Object.values(docs.views)];

describe('links to the docs', () => {
	it('uses the documentation site as its base', () => {
		expect(docs.base).toBe('https://matters-that-matter.app/docs/');
	});

	it.each(urls)('%s is a well-formed https URL under the base', (url) => {
		const parsed = new URL(url);
		expect(parsed.protocol).toBe('https:');
		expect(parsed.href).toBe(url);
		expect(url.startsWith(docs.base)).toBe(true);
		expect(parsed.search).toBe('');
		expect(parsed.hash).toBe('');
		// A page or a folder: the site serves pages at their .html paths and a folder at its index.
		expect(url.endsWith('/') || url.endsWith('.html')).toBe(true);
	});

	it('gives every view a page and a tooltip naming it', () => {
		for (const view of ['board', 'list', 'calendar', 'timeline'] as const) {
			expect(docs.views[view]).toBe(`${docs.base}views/${view}.html`);
			expect(docs.viewHelp[view]).toBe(`How the ${view} works ↗`);
		}
	});
});
