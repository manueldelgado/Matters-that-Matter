// Action and Matter titles are file names.

const FORBIDDEN = /[/\\:*?"<>|#^[\]]/g;
export const MAX_TITLE_LENGTH = 100;

/** Removes characters that break file names or links, collapses whitespace, trims and caps the length. */
export function sanitiseTitle(raw: string): string {
	const clean = raw
		.replace(FORBIDDEN, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		// A leading dot would hide the file.
		.replace(/^\.+\s*/, '');
	return capLength(clean, MAX_TITLE_LENGTH);
}

function capLength(value: string, max: number): string {
	const chars = Array.from(value);
	return chars.length <= max ? value : chars.slice(0, max).join('').trimEnd();
}

/** The title itself, or with " 2", " 3"… appended until `exists` says it is free. */
export function uniqueTitle(title: string, exists: (candidate: string) => boolean): string {
	if (!exists(title)) return title;
	for (let n = 2; ; n++) {
		const suffix = ` ${n}`;
		const candidate = capLength(title, MAX_TITLE_LENGTH - suffix.length) + suffix;
		if (!exists(candidate)) return candidate;
	}
}
