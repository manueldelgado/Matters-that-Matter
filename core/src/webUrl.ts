// The WHATWG URL parser for http and https addresses, for hosts without a `URL` class (JavaScriptCore has none): the
// core uses `new URL(text)` only to write a web address as browsers serialise it (`href`), and to read its scheme.
// It follows the URL Standard's basic parser for those two schemes: tabs and newlines removed, backslashes read as
// slashes, user info, ports (the default one dropped), IPv4 in every form the standard reads, IPv6 compressed, dot
// segments, and each part percent-encoded with its own set. A host with characters beyond ASCII goes through UTS 46
// approximately: compatibility-normalised, lower-cased and Punycode-encoded label by label; the full mapping table
// is left out. Any other scheme is refused, as an address that can't be parsed is: with a TypeError. Pure.

// ——— Percent-encoding ———

const C0_OR_ABOVE = (c: number) => c < 0x20 || c > 0x7e;
const FRAGMENT_SET = new Set(' "<>`');
const SPECIAL_QUERY_SET = new Set(' "#<>\'');
const PATH_SET = new Set(' "#<>?^`{}');
const USERINFO_SET = new Set(' "#<>?^`{}/:;=@[\\]|');

/** A code point's UTF-8 bytes; a lone surrogate is written as U+FFFD, as the standard's encoder does. */
function utf8(cp: number): number[] {
	if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
	if (cp < 0x80) return [cp];
	if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)];
	if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
	return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
}

const hexByte = (b: number) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`;

function percentEncode(text: string, set: ReadonlySet<string>): string {
	let out = '';
	for (const ch of text) {
		const cp = ch.codePointAt(0) ?? 0;
		out += C0_OR_ABOVE(cp) || set.has(ch) ? utf8(cp).map(hexByte).join('') : ch;
	}
	return out;
}

/** `%XX` sequences read as bytes, then the bytes read as UTF-8; anything that isn't UTF-8 becomes U+FFFD. */
function percentDecode(text: string): string {
	const bytes: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const hex = text.slice(i + 1, i + 3);
		if (text[i] === '%' && /^[0-9a-fA-F]{2}$/.test(hex)) {
			bytes.push(parseInt(hex, 16));
			i += 2;
		} else {
			bytes.push(...utf8(text.codePointAt(i) ?? 0));
			if ((text.codePointAt(i) ?? 0) > 0xffff) i++;
		}
	}
	return decodeUtf8(bytes);
}

function decodeUtf8(bytes: readonly number[]): string {
	let out = '';
	for (let i = 0; i < bytes.length; ) {
		const b = bytes[i] ?? 0;
		const need = b < 0x80 ? 0 : b >= 0xc2 && b <= 0xdf ? 1 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xf0 && b <= 0xf4 ? 3 : -1;
		if (need < 0) {
			out += '\ufffd';
			i++;
			continue;
		}
		let cp = need === 0 ? b : b & (0x3f >> need);
		let j = 1;
		for (; j <= need; j++) {
			const next = bytes[i + j];
			if (next === undefined || (next & 0xc0) !== 0x80) break;
			cp = (cp << 6) | (next & 0x3f);
		}
		const overlong = (need === 2 && cp < 0x800) || (need === 3 && (cp < 0x10000 || cp > 0x10ffff)) || (cp >= 0xd800 && cp <= 0xdfff);
		if (j <= need || overlong) {
			out += '\ufffd';
			i += Math.max(1, j);
			continue;
		}
		out += String.fromCodePoint(cp);
		i += need + 1;
	}
	return out;
}

// ——— Hosts ———

const failure = () => new TypeError('Invalid URL');

// eslint-disable-next-line no-control-regex -- the standard forbids control characters in a host
const FORBIDDEN_DOMAIN = /[\u0000- #%/:<>?@[\\\]^|\u007f]/;

/** Code points UTS 46 never allows in a label: controls, and what decoding put in place of bytes that weren't UTF-8. */
// eslint-disable-next-line no-control-regex -- UTS 46 disallows control characters
const DISALLOWED = /[\u0000-\u001f\u007f-\u009f\ufffd]/;

/** UTS 46 maps these to nothing. */
const IGNORED = /\u00ad|\u034f|[\u180b-\u180f]|\u200b|\u2060|[\ufe00-\ufe0f]|\ufeff/g;

const PUNY = { base: 36, tMin: 1, tMax: 26, skew: 38, damp: 700, initialBias: 72, initialN: 128 };

function adapt(delta: number, points: number, first: boolean): number {
	delta = first ? Math.floor(delta / PUNY.damp) : delta >> 1;
	delta += Math.floor(delta / points);
	let k = 0;
	while (delta > ((PUNY.base - PUNY.tMin) * PUNY.tMax) >> 1) {
		delta = Math.floor(delta / (PUNY.base - PUNY.tMin));
		k += PUNY.base;
	}
	return k + Math.floor(((PUNY.base - PUNY.tMin + 1) * delta) / (delta + PUNY.skew));
}

const digit = (d: number) => String.fromCharCode(d + 22 + 75 * Number(d < 26));

function punycodeEncode(label: string): string {
	const cps = [...label].map((c) => c.codePointAt(0) ?? 0);
	let out = cps.filter((c) => c < 0x80).map((c) => String.fromCharCode(c)).join('');
	const basic = out.length;
	let handled = basic;
	if (basic) out += '-';
	let n = PUNY.initialN;
	let delta = 0;
	let bias = PUNY.initialBias;
	while (handled < cps.length) {
		const m = Math.min(...cps.filter((c) => c >= n));
		delta += (m - n) * (handled + 1);
		n = m;
		for (const c of cps) {
			if (c < n) delta++;
			if (c !== n) continue;
			let q = delta;
			for (let k = PUNY.base; ; k += PUNY.base) {
				const t = k <= bias ? PUNY.tMin : k >= bias + PUNY.tMax ? PUNY.tMax : k - bias;
				if (q < t) break;
				out += digit(t + ((q - t) % (PUNY.base - t)));
				q = Math.floor((q - t) / (PUNY.base - t));
			}
			out += digit(q);
			bias = adapt(delta, handled + 1, handled === basic);
			delta = 0;
			handled++;
		}
		delta++;
		n++;
	}
	return out;
}

/** A Punycode label decoded, or null when it isn't valid Punycode. */
function punycodeDecode(input: string): string | null {
	const cps: number[] = [];
	const dash = input.lastIndexOf('-');
	for (let i = 0; i < Math.max(dash, 0); i++) {
		const c = input.charCodeAt(i);
		if (c >= 0x80) return null;
		cps.push(c);
	}
	let n = PUNY.initialN;
	let bias = PUNY.initialBias;
	let i = 0;
	for (let pos = dash >= 0 ? dash + 1 : 0; pos < input.length; ) {
		const old = i;
		for (let w = 1, k = PUNY.base; ; k += PUNY.base) {
			if (pos >= input.length) return null;
			const c = input.charCodeAt(pos++);
			const d = c >= 48 && c <= 57 ? c - 22 : c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 97 : PUNY.base;
			if (d >= PUNY.base) return null;
			i += d * w;
			const t = k <= bias ? PUNY.tMin : k >= bias + PUNY.tMax ? PUNY.tMax : k - bias;
			if (d < t) break;
			w *= PUNY.base - t;
			if (w > 0x7fffffff) return null;
		}
		bias = adapt(i - old, cps.length + 1, old === 0);
		n += Math.floor(i / (cps.length + 1));
		i %= cps.length + 1;
		if (n > 0x10ffff) return null;
		cps.splice(i++, 0, n);
	}
	return String.fromCodePoint(...cps);
}

function domainToAscii(domain: string): string {
	// eslint-disable-next-line no-control-regex -- ASCII is U+0000 to U+007F
	const ascii = /^[\u0000-\u007f]*$/.test(domain);
	if (ascii && !domain.split('.').some((l) => /^xn--/i.test(l))) return domain.toLowerCase();
	const mapped = domain.replace(IGNORED, '').normalize('NFKC').toLowerCase().replace(/[\u3002\uff0e\uff61]/g, '.');
	if (DISALLOWED.test(mapped)) throw failure();
	const labels = mapped.split('.').map((label) => {
		if (label.startsWith('xn--')) {
			const decoded = punycodeDecode(label.slice(4));
			// eslint-disable-next-line no-control-regex -- ASCII is U+0000 to U+007F
			const valid = decoded !== null && decoded !== '' && !/^[\u0000-\u007f]*$/.test(decoded) && !DISALLOWED.test(decoded);
			// A label already encoded must be one the mapping leaves as it is.
			if (!valid || decoded.normalize('NFKC').toLowerCase() !== decoded) throw failure();
			return label;
		}
		// eslint-disable-next-line no-control-regex -- ASCII is U+0000 to U+007F
		return /^[\u0000-\u007f]*$/.test(label) ? label : `xn--${punycodeEncode(label)}`;
	});
	const out = labels.join('.');
	if (out === '') throw failure();
	return out;
}

function endsInNumber(host: string): boolean {
	const parts = host.split('.');
	if (parts[parts.length - 1] === '' && parts.length > 1) parts.pop();
	const last = parts[parts.length - 1] ?? '';
	return /^[0-9]+$/.test(last) || /^0x[0-9a-f]*$/i.test(last);
}

function ipv4Number(part: string): number | null {
	if (part === '') return null;
	let radix = 10;
	let digits = part;
	if (/^0x/i.test(part)) {
		radix = 16;
		digits = part.slice(2);
	} else if (part.length > 1 && part.startsWith('0')) {
		radix = 8;
		digits = part.slice(1);
	}
	if (digits === '') return 0;
	const valid = radix === 16 ? /^[0-9a-f]+$/i : radix === 8 ? /^[0-7]+$/ : /^[0-9]+$/;
	if (!valid.test(digits)) return null;
	return parseInt(digits, radix);
}

function ipv4(host: string): string {
	const parts = host.split('.');
	if (parts[parts.length - 1] === '' && parts.length > 1) parts.pop();
	if (parts.length > 4) throw failure();
	const numbers = parts.map((p) => {
		const n = ipv4Number(p);
		if (n === null) throw failure();
		return n;
	});
	const last = numbers.pop() ?? 0;
	if (numbers.some((n) => n > 255) || last >= 256 ** (5 - parts.length)) throw failure();
	let value = last;
	numbers.forEach((n, i) => (value += n * 256 ** (3 - i)));
	return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

function ipv6(input: string): string {
	const pieces = [0, 0, 0, 0, 0, 0, 0, 0];
	let piece = 0;
	let compress: number | null = null;
	let p = 0;
	const at = (i: number) => input[i];
	if (at(p) === ':') {
		if (at(p + 1) !== ':') throw failure();
		p += 2;
		compress = ++piece;
	}
	while (p < input.length) {
		if (piece === 8) throw failure();
		if (at(p) === ':') {
			if (compress !== null) throw failure();
			p++;
			compress = ++piece;
			continue;
		}
		let value = 0;
		let length = 0;
		while (length < 4 && /[0-9a-f]/i.test(at(p) ?? '')) {
			value = value * 16 + parseInt(at(p) ?? '0', 16);
			p++;
			length++;
		}
		if (at(p) === '.') {
			if (length === 0) throw failure();
			p -= length;
			if (piece > 6) throw failure();
			let seen = 0;
			while (p < input.length) {
				let v4: number | null = null;
				if (seen > 0) {
					if (at(p) === '.' && seen < 4) p++;
					else throw failure();
				}
				if (!/[0-9]/.test(at(p) ?? '')) throw failure();
				while (/[0-9]/.test(at(p) ?? '')) {
					const n = parseInt(at(p) ?? '0', 10);
					if (v4 === null) v4 = n;
					else if (v4 === 0) throw failure();
					else v4 = v4 * 10 + n;
					if (v4 > 255) throw failure();
					p++;
				}
				pieces[piece] = (pieces[piece] ?? 0) * 0x100 + (v4 ?? 0);
				seen++;
				if (seen === 2 || seen === 4) piece++;
			}
			if (seen !== 4) throw failure();
			break;
		} else if (at(p) === ':') {
			p++;
			if (p >= input.length) throw failure();
		} else if (p < input.length) {
			throw failure();
		}
		pieces[piece++] = value;
	}
	if (compress !== null) {
		let swaps = piece - compress;
		piece = 7;
		while (piece !== 0 && swaps > 0) {
			const from = compress + swaps - 1;
			[pieces[piece], pieces[from]] = [pieces[from] ?? 0, pieces[piece] ?? 0];
			piece--;
			swaps--;
		}
	} else if (piece !== 8) {
		throw failure();
	}
	// The first longest run of two or more zero pieces is written as `::`.
	let best = -1;
	let bestLength = 1;
	for (let i = 0; i < 8; ) {
		let j = i;
		while (j < 8 && pieces[j] === 0) j++;
		if (j - i > bestLength) {
			best = i;
			bestLength = j - i;
		}
		i = j === i ? i + 1 : j;
	}
	let out = '';
	for (let i = 0; i < 8; i++) {
		if (i === best) {
			out += i === 0 ? '::' : ':';
			i += bestLength - 1;
			continue;
		}
		out += (pieces[i] ?? 0).toString(16) + (i < 7 ? ':' : '');
	}
	return `[${out}]`;
}

function parseHost(input: string): string {
	if (input.startsWith('[')) {
		if (!input.endsWith(']')) throw failure();
		return ipv6(input.slice(1, -1));
	}
	const ascii = domainToAscii(percentDecode(input));
	if (FORBIDDEN_DOMAIN.test(ascii)) throw failure();
	return endsInNumber(ascii) ? ipv4(ascii) : ascii;
}

// ——— Paths ———

const SINGLE_DOT = /^(?:\.|%2e)$/i;
const DOUBLE_DOT = /^(?:\.|%2e)(?:\.|%2e)$/i;

function parsePath(input: string): string {
	const segments: string[] = [];
	const parts = input.split(/[/\\]/);
	// The text before the first slash (none for a path that starts with one) and each part after a slash.
	const ends = parts.slice(input.startsWith('/') || input.startsWith('\\') ? 1 : 0);
	ends.forEach((part, i) => {
		const last = i === ends.length - 1;
		if (DOUBLE_DOT.test(part)) {
			segments.pop();
			if (last) segments.push('');
		} else if (SINGLE_DOT.test(part)) {
			if (last) segments.push('');
		} else {
			segments.push(percentEncode(part, PATH_SET));
		}
	});
	return `/${segments.join('/')}`;
}

// ——— The address ———

const DEFAULT_PORTS: Readonly<Record<string, string>> = { 'http:': '80', 'https:': '443' };

/** An http or https address, parsed as the URL Standard parses it. Only `href` and `protocol` are offered. */
export class WebURL {
	readonly href: string;
	readonly protocol: string;

	constructor(input: string) {
		// eslint-disable-next-line no-control-regex -- ASCII is U+0000 to U+007F
		const text = String(input).replace(/^[\u0000- ]+|[\u0000- ]+$/g, '').replace(/[\t\n\r]/g, '');
		const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(text);
		const protocol = `${scheme?.[1]?.toLowerCase() ?? ''}:`;
		if (!scheme || !(protocol in DEFAULT_PORTS)) throw failure();
		let rest = text.slice(scheme[0].length).replace(/^[/\\]*/, '');

		const authorityEnd = rest.search(/[/\\?#]/);
		const authority = authorityEnd < 0 ? rest : rest.slice(0, authorityEnd);
		rest = authorityEnd < 0 ? '' : rest.slice(authorityEnd);
		const at = authority.lastIndexOf('@');
		let userinfo = '';
		if (at >= 0) {
			const raw = authority.slice(0, at);
			const colon = raw.indexOf(':');
			const user = percentEncode(colon < 0 ? raw : raw.slice(0, colon), USERINFO_SET);
			const password = colon < 0 ? '' : percentEncode(raw.slice(colon + 1), USERINFO_SET);
			if (user || password) userinfo = `${user}${password ? `:${password}` : ''}@`;
		}
		const hostAndPort = authority.slice(at + 1);
		if (at >= 0 && hostAndPort === '') throw failure();
		// The port follows the first colon outside brackets.
		let colon = -1;
		for (let i = 0, inBrackets = false; i < hostAndPort.length; i++) {
			const ch = hostAndPort[i];
			if (ch === '[') inBrackets = true;
			else if (ch === ']') inBrackets = false;
			else if (ch === ':' && !inBrackets) {
				colon = i;
				break;
			}
		}
		const hostText = colon < 0 ? hostAndPort : hostAndPort.slice(0, colon);
		if (hostText === '') throw failure();
		const host = parseHost(hostText);
		let port = '';
		if (colon >= 0) {
			const digits = hostAndPort.slice(colon + 1);
			if (!/^[0-9]*$/.test(digits)) throw failure();
			if (digits !== '') {
				const n = parseInt(digits, 10);
				if (n > 65535) throw failure();
				port = String(n) === DEFAULT_PORTS[protocol] ? '' : `:${n}`;
			}
		}

		const hash = rest.indexOf('#');
		const fragment = hash < 0 ? null : rest.slice(hash + 1);
		const beforeHash = hash < 0 ? rest : rest.slice(0, hash);
		const question = beforeHash.indexOf('?');
		const query = question < 0 ? null : beforeHash.slice(question + 1);
		const path = parsePath(question < 0 ? beforeHash : beforeHash.slice(0, question));

		this.protocol = protocol;
		this.href =
			`${protocol}//${userinfo}${host}${port}${path}` +
			(query === null ? '' : `?${percentEncode(query, SPECIAL_QUERY_SET)}`) +
			(fragment === null ? '' : `#${percentEncode(fragment, FRAGMENT_SET)}`);
	}
}
