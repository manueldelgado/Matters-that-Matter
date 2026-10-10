// `--json` output for scripts: reads give the operation's value as it is (raw and effective values, so scripts never
// re-implement the rules); writes give the value with what changed; errors give the error with its candidates.

import type { ActionSummary, Change, MatterSummary, OpError, Warning } from '../../src/ops/types';
import type { FileOutcome, LinkUpdate } from './filesLayer';

export interface WriteJson {
	/** The Action (or, for add-matter, the Matter) as it reads after the write. */
	action?: ActionSummary;
	matter?: MatterSummary;
	/** False when everything already was as asked and nothing was planned. */
	changed: boolean;
	dryRun: boolean;
	/** True only when files were written. */
	written: boolean;
	changes: Change[];
	warnings: Warning[];
	/** Links a rename updated (or, in a dry run, would update). */
	links: LinkUpdate[];
	/** Links left pointing to a renamed note's old name. */
	danglingLinks: number;
}

export function writeJson(
	value: { action: ActionSummary } | { matter: MatterSummary },
	r: { changes: Change[]; warnings: Warning[] },
	outcome: FileOutcome | null,
	dryRun: boolean,
	written: boolean,
): WriteJson {
	return {
		...value,
		changed: r.changes.length > 0,
		dryRun,
		written,
		changes: r.changes,
		warnings: r.warnings,
		links: outcome?.links ?? [],
		danglingLinks: outcome?.danglingLinks ?? 0,
	};
}

/** Every error, from the vault guards to an operation's refusal, in one shape. */
export type ErrorJson = { error: OpError | { code: 'changed' | 'usage' | 'open-failed'; message: string; path?: string; url?: string } };

export const errorJson = (error: ErrorJson['error']): ErrorJson => ({ error });

export const stringify = (value: unknown): string => JSON.stringify(value, null, 2);
