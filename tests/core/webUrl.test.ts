// The bundle's URL parser against Node's own (the URL Standard's): the same `href` for every http(s) address, and a
// TypeError for the same addresses. Hand-picked cases, then generated ones from a fixed seed.

import { describe, expect, it } from 'vitest';
import { WebURL } from '../../core/src/webUrl';

/** `href`, or the error's name. */
const parse = (Parser: new (text: string) => { href: string }, text: string): string => {
	try {
		return new Parser(text).href;
	} catch (error) {
		return error instanceof TypeError ? 'TypeError' : `other: ${String(error)}`;
	}
};

const CASES = [
	'https://example.com/guides/tiling?step=1',
	'HTTPS://EXAMPLE.COM/A/B',
	'http://example.com',
	'http://example.com?q',
	'http://example.com#f',
	'https:example.com/a',
	'https:/example.com/a',
	'https:\\\\example.com\\a\\b',
	'https:////example.com///a',
	'http://user:pass@example.com:8080/p',
	'http://user@example.com/',
	'http://:@example.com/',
	'http://a@b@c/',
	'http://us er:pa:ss@h/',
	'http://@example.com/',
	'http://example.com:80/',
	'https://example.com:443/',
	'https://example.com:0443/',
	'http://example.com:/',
	'http://example.com:65535/',
	'http://example.com:65536/',
	'http://example.com:8a/',
	'http://192.168.0.1/',
	'http://0x7f.1/',
	'http://0177.0.0.1/',
	'http://2130706433/',
	'http://1.2.3.4.5/',
	'http://1.2.3.256/',
	'http://1.2.3/',
	'http://1.2.3.4./',
	'http://0x/',
	'http://09/',
	'http://foo.09/',
	'http://foo.0x1/',
	'http://[::1]/',
	'http://[::1]:8080/',
	'http://[2001:db8:0:0:0:0:2:1]/',
	'http://[2001:DB8::1:0:0:1]/',
	'http://[::ffff:192.168.1.1]/',
	'http://[1:0:0:2::3:0]/',
	'http://[0:0:0:0:0:0:0:0]/',
	'http://[1::2::3]/',
	'http://[::1/',
	'http://[1:2:3:4:5:6:7:8:9]/',
	'http://[::1.2.3.4.5]/',
	'http://exa mple.com/',
	'http://exa%20mple.com/',
	'http://exa%41mple.com/',
	'http://a<b/',
	'http://a^b/',
	'http://a|b/',
	'http://a%/',
	'http://a_b*c.com/',
	'http://münchen.de/',
	'http://MÜNCHEN.DE/straße',
	'http://straße.de/',
	'http://日本語.jp/パス?クエリ#フラグメント',
	'http://xn--mnchen-3ya.de/',
	'http://xn--abc/',
	'http://xn--/',
	'http://ｅｘａｍｐｌｅ．ｃｏｍ/',
	'http://example。com/',
	'http://example.com./',
	'http://a..b/',
	'http://.example.com/',
	'http://example.com/a/./b/../c',
	'http://example.com/a/%2e/b/%2E%2e/c',
	'http://example.com/a/..',
	'http://example.com/a/.',
	'http://example.com/..',
	'http://example.com/a/b/',
	'http://example.com/a\\b/c',
	'http://example.com/ "<>`{}^|~[]@!$&\'()*+,;=:',
	'http://example.com/?a b"#x',
	'http://example.com/?\'<>`{}^|',
	'http://example.com/#a b"<>`{}#^|',
	'http://example.com/%zz%2',
	'http://example.com/é?é#é',
	'http://example.com/\u{1f600}',
	'http://example.com/\ud800',
	'http://exa\tmple.com/a\nb\rc',
	'  http://example.com/  ',
	'\u0001http://example.com/\u0002',
	'http://example.com/\u007f',
	'http://',
	'http:///',
	'http://?x',
	'http://xn--ls8h/',
	'http://xn--a/',
	'http://xn--abc-/',
	'http://\u0085.com/',
];

/** A small, seeded generator, so the generated cases are the same on every run. */
function generator(seed: number) {
	let s = seed;
	const next = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
	return { pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T, chance: (p: number) => next() < p };
}

const PIECES = ['a', 'B', '0', '9', 'x', '.', '..', '/', '\\', '?', '#', '@', ':', '%', '%2e', '%41', '%zz', ' ', '"', "'", '<', '>', '`', '{', '}', '^', '|', '[', ']', '~', '!', '$', '&', '(', ')', '*', '+', ',', ';', '=', '-', '_', 'é', 'ß', '日', '\u{1f600}', '\t', '\u0000', '\u007f', '\u00ad', 'xn--', '0x', '1', '255', '256'];
const HOSTS = ['example.com', 'EXAMPLE.org', 'münchen.de', '127.0.0.1', '0x7f.1', '[::1]', '[1:2::3]', 'a.b.c', 'localhost', '日本.jp', 'xn--mnchen-3ya.de', '1.2.3'];

function generated(count: number): string[] {
	const g = generator(20261016);
	const out: string[] = [];
	for (let i = 0; i < count; i++) {
		const bits = (n: number) => Array.from({ length: n }, () => g.pick(PIECES)).join('');
		const host = g.chance(0.7) ? g.pick(HOSTS) : bits(1 + Math.floor(i % 4));
		const user = g.chance(0.15) ? `${bits(2)}@` : '';
		const port = g.chance(0.15) ? `:${g.pick(['80', '443', '8080', '', '0', '99999', 'x'])}` : '';
		out.push(`${g.pick(['http', 'https', 'HTTP'])}:${g.pick(['//', '///', '\\\\', '/'])}${user}${host}${port}${g.chance(0.8) ? `/${bits(1 + (i % 7))}` : ''}${g.chance(0.3) ? `?${bits(3)}` : ''}${g.chance(0.2) ? `#${bits(3)}` : ''}`);
	}
	return out;
}

describe('the bundle’s URL parser', () => {
	it.each(CASES)('%s', (text) => {
		expect(parse(WebURL, text)).toBe(parse(URL, text));
	});

	it('agrees with the URL Standard on 5,000 generated addresses', () => {
		const differ = generated(5000).filter((text) => parse(WebURL, text) !== parse(URL, text));
		expect(differ.map((text) => [text, parse(WebURL, text), parse(URL, text)])).toEqual([]);
	});

	it.each(['mailto:someone@example.com', 'ftp://example.com/', 'javascript:alert(1)', 'example.com'])('refuses %s: http and https only', (text) => {
		expect(parse(WebURL, text)).toBe('TypeError');
	});

	it('gives the scheme as `protocol`', () => {
		expect(new WebURL('HTTPS://example.com').protocol).toBe('https:');
	});
});
