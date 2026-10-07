// Stable IDs for statuses and types, generated once from the label.

/** Lowercase ASCII letters, digits and single hyphens; accents are dropped ("Revisión" → "revision"). */
export function slug(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** A new ID from a label, with a numeric suffix if it collides with an existing ID. */
export function idFromLabel(label: string, existing: Iterable<string>): string {
	const taken = new Set(existing);
	const base = slug(label) || 'item';
	if (!taken.has(base)) return base;
	let n = 2;
	while (taken.has(`${base}-${n}`)) n++;
	return `${base}-${n}`;
}

/** An ID made safe for use in a class name such as `mtm-type-<id>`. */
export function classId(id: string): string {
	return slug(id) || '_';
}
