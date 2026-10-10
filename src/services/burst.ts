// A limit on Actions added through links: a page that opens links in a loop can't flood the vault. Pure: the time
// is passed in.

/** How many adds a window may hold, and how long the window is. */
export const BURST_LIMIT = 10;
export const BURST_WINDOW_MS = 60_000;

export interface BurstVerdict {
	/** Whether this add may go ahead. */
	allowed: boolean;
	/** True only for the add that starts the stop, so one notice says so (not one per refused link). */
	notify: boolean;
}

/**
 * More than ten adds within a minute stops further adds. Once stopped, every add is refused until a minute has
 * passed since the stop; then the window starts empty again.
 */
export class BurstLimiter {
	private times: number[] = [];
	private stoppedUntil: number | null = null;

	constructor(
		private readonly limit = BURST_LIMIT,
		private readonly windowMs = BURST_WINDOW_MS,
	) {}

	attempt(now: number): BurstVerdict {
		if (this.stoppedUntil !== null) {
			if (now < this.stoppedUntil) return { allowed: false, notify: false };
			this.stoppedUntil = null;
			this.times = [];
		}
		this.times = this.times.filter((t) => now - t < this.windowMs);
		if (this.times.length >= this.limit) {
			this.stoppedUntil = now + this.windowMs;
			return { allowed: false, notify: true };
		}
		this.times.push(now);
		return { allowed: true, notify: false };
	}

	/** Whether adds are stopped at this time. */
	stopped(now: number): boolean {
		return this.stoppedUntil !== null && now < this.stoppedUntil;
	}
}

/** The gap kept between two showings of the same notice from links. */
export const NOTICE_GAP_MS = 10_000;

/**
 * Keeps repeated notices apart: a notice with the same key shows again only once its gap has passed, so a burst of
 * links that fail the same way shows one notice. Pure: the time is passed in.
 */
export class NoticeGap {
	private readonly shown = new Map<string, number>();

	constructor(private readonly gapMs = NOTICE_GAP_MS) {}

	allow(key: string, now: number, gapMs = this.gapMs): boolean {
		const last = this.shown.get(key);
		if (last !== undefined && now - last < gapMs) return false;
		this.shown.set(key, now);
		return true;
	}
}
