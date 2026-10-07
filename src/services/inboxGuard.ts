// Pure rules behind the Inbox protection. The event wiring lives with the plugin.

export interface InboxRepair {
	'mtm-kind'?: 'matter';
	'mtm-state'?: 'active';
}

/** Restores a removed mtm-kind and reverts a hand-edited mtm-state; empty when nothing to fix. */
export function inboxRepairs(fm: Readonly<Record<string, unknown>> | null | undefined): InboxRepair {
	const out: InboxRepair = {};
	if (fm?.['mtm-kind'] !== 'matter') out['mtm-kind'] = 'matter';
	const state = fm?.['mtm-state'];
	if (state !== undefined && state !== null && state !== 'active') out['mtm-state'] = 'active';
	return out;
}

/** The new inboxPath after a rename, or null if the renamed file was not the Inbox. */
export function inboxPathAfterRename(oldPath: string, newPath: string, inboxPath: string): string | null {
	return oldPath === inboxPath ? newPath : null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Inbox 1.md" next to "Inbox.md": a duplicate left behind by sync or a restore. */
export function isInboxDuplicate(path: string, inboxPath: string): boolean {
	const slash = inboxPath.lastIndexOf('/');
	const folder = inboxPath.slice(0, slash + 1);
	const name = inboxPath.slice(slash + 1).replace(/\.md$/i, '');
	return new RegExp(`^${escape(folder)}${escape(name)} \\d+\\.md$`, 'i').test(path);
}
