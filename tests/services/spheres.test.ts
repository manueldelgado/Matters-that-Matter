import { describe, expect, it } from 'vitest';
import { effectiveSphere, focusedSphere, groupBySphere, NO_SPHERE, sphereKeys, sphereShown } from '../../src/services/spheres';

const spheres = [
	{ id: 'home', label: 'Home', icon: 'house' },
	{ id: 'work', label: 'Work', icon: 'briefcase' },
];

describe('effectiveSphere', () => {
	it('is none when absent, the ID when known, none with an orphan when unknown', () => {
		expect(effectiveSphere(undefined, spheres, false)).toEqual({ id: null, orphan: null });
		expect(effectiveSphere('work', spheres, false)).toEqual({ id: 'work', orphan: null });
		expect(effectiveSphere('garden', spheres, false)).toEqual({ id: null, orphan: 'garden' });
	});

	it('ignores a Sphere on the Inbox', () => {
		expect(effectiveSphere('work', spheres, true)).toEqual({ id: null, orphan: null });
	});
});

describe('focus', () => {
	const keys = sphereKeys(spheres, true);

	it('offers every Sphere, and No Sphere only when some Matter has none', () => {
		expect(keys).toEqual(['home', 'work', NO_SPHERE]);
		expect(sphereKeys(spheres, false)).toEqual(['home', 'work']);
	});

	it('shows what is on; with every chip off, nothing', () => {
		expect(sphereShown('home', new Set(['home']))).toBe(false);
		expect(sphereShown(null, new Set(['home']))).toBe(true);
		expect(sphereShown(null, new Set([NO_SPHERE]))).toBe(false);
		expect(sphereShown('home', new Set(keys))).toBe(false);
	});

	it('names the one Sphere in focus', () => {
		expect(focusedSphere(new Set(['home', NO_SPHERE]), keys)).toBe('work');
		expect(focusedSphere(new Set(['home']), keys)).toBeNull();
		expect(focusedSphere(new Set(['home', 'work']), keys)).toBeNull();
	});
});

describe('groupBySphere', () => {
	it('groups in settings order, No Sphere last, leaving out empty groups and keeping item order', () => {
		const items = [
			{ n: 'a', s: null },
			{ n: 'b', s: 'work' },
			{ n: 'c', s: 'gone' },
			{ n: 'd', s: 'work' },
		];
		const groups = groupBySphere(items, (i) => i.s, spheres);
		expect(groups.map((g) => [g.sphere?.id ?? null, g.items.map((i) => i.n)])).toEqual([
			['work', ['b', 'd']],
			[null, ['a', 'c']],
		]);
	});
});
