// The wall clock every rule reads: the snapshot's `now` in its time zone, so "today" is the same wherever the
// operations run. Pure.

import { wallClock } from '../model/dates';
import type { Snapshot } from './types';

const clocks = new WeakMap<Snapshot, Date>();

/** The snapshot's `now` as wall-clock time in its time zone (the host's when it names none), as a local `Date`. */
export function clock(s: Snapshot): Date {
	let c = clocks.get(s);
	if (!c) {
		c = wallClock(s.now, s.timeZone);
		clocks.set(s, c);
	}
	return c;
}
