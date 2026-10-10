// Field names as other tools see them: the property names without `mtm-` (`waiting-on`, `review-every`), and the
// list filters' own names. The operations take camelCase keys and report the public names in errors and warnings;
// command lines and tool schemas map their arguments with the same table.

export const PUBLIC_FIELDS = {
	waitingOn: 'waiting-on',
	reviewEvery: 'review-every',
	dueFrom: 'due-from',
	dueTo: 'due-to',
} as const;

/** The public name of an input key; keys that are one word are the same in both. */
export function publicField(key: string): string {
	return (PUBLIC_FIELDS as Record<string, string>)[key] ?? key;
}

/** The input key of a public name (`waiting-on` → `waitingOn`). */
export function inputKey(name: string): string {
	return Object.entries(PUBLIC_FIELDS).find(([, v]) => v === name)?.[0] ?? name;
}
