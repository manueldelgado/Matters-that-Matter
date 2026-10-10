// Mark as done: the done status, with today's completion date. An Action already in it is left as it is.

import { doneStatus } from '../model/workflow';
import { moveToStatus } from './actionWrite';
import type { ActionWrite, OpResult, Snapshot } from './types';

export function markAsDone(action: string, s: Snapshot): OpResult<ActionWrite> {
	return moveToStatus(action, s, doneStatus, (_category, statusId, doneId) => statusId === doneId);
}
