import { describe, expect, it } from 'vitest';
import { BURST_LIMIT, BURST_WINDOW_MS, BurstLimiter, NOTICE_GAP_MS, NoticeGap } from '../../src/services/burst';

const T0 = 1_000_000;

describe('burst limit for links', () => {
	it('lets ten adds through within a minute and refuses the eleventh, with one notice', () => {
		const limiter = new BurstLimiter();
		for (let i = 0; i < BURST_LIMIT; i++) expect(limiter.attempt(T0 + i * 1000)).toEqual({ allowed: true, notify: false });
		expect(limiter.attempt(T0 + 10_000)).toEqual({ allowed: false, notify: true });
		expect(limiter.attempt(T0 + 11_000)).toEqual({ allowed: false, notify: false });
		expect(limiter.attempt(T0 + 40_000)).toEqual({ allowed: false, notify: false });
		expect(limiter.stopped(T0 + 40_000)).toBe(true);
	});

	it('works again a minute after it stopped, with an empty window', () => {
		const limiter = new BurstLimiter();
		for (let i = 0; i <= BURST_LIMIT; i++) limiter.attempt(T0 + i);
		const stoppedAt = T0 + BURST_LIMIT;
		expect(limiter.attempt(stoppedAt + BURST_WINDOW_MS - 1).allowed).toBe(false);
		expect(limiter.stopped(stoppedAt + BURST_WINDOW_MS)).toBe(false);
		for (let i = 0; i < BURST_LIMIT; i++) expect(limiter.attempt(stoppedAt + BURST_WINDOW_MS + i).allowed).toBe(true);
		expect(limiter.attempt(stoppedAt + BURST_WINDOW_MS + BURST_LIMIT)).toEqual({ allowed: false, notify: true });
	});

	it('counts only the last minute: ten spread over more than a minute never stop it', () => {
		const limiter = new BurstLimiter();
		for (let i = 0; i < 30; i++) expect(limiter.attempt(T0 + i * 7_000).allowed).toBe(true);
	});

	it('refuses nothing below the limit, however close together', () => {
		const limiter = new BurstLimiter();
		for (let i = 0; i < BURST_LIMIT; i++) expect(limiter.attempt(T0).allowed).toBe(true);
		expect(limiter.attempt(T0).allowed).toBe(false);
	});
});

describe('repeated notices from links', () => {
	it('shows a notice once per gap, each kind on its own', () => {
		const gap = new NoticeGap();
		expect(gap.allow('No Action called “x” here.', T0)).toBe(true);
		expect(gap.allow('No Action called “x” here.', T0 + 1_000)).toBe(false);
		expect(gap.allow('Matters isn’t set up', T0 + 1_000)).toBe(true);
		expect(gap.allow('No Action called “x” here.', T0 + NOTICE_GAP_MS)).toBe(true);
	});

	it('takes a longer gap for a notice that asks for one', () => {
		const gap = new NoticeGap();
		expect(gap.allow('off', T0, 60_000)).toBe(true);
		expect(gap.allow('off', T0 + 30_000, 60_000)).toBe(false);
		expect(gap.allow('off', T0 + 60_000, 60_000)).toBe(true);
	});
});
