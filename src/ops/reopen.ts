// Reopen: a closed Action goes back to the backlog status and loses its completion date. Open Actions are left as they are.

import { backlogStatus } from '../model/workflow';
import { moveToStatus } from './actionWrite';
import type { ActionWrite, OpResult, Snapshot } from './types';

export function reopen(action: string, s: Snapshot): OpResult<ActionWrite> {
	return moveToStatus(action, s, backlogStatus, (category) => category !== 'closed');
}
