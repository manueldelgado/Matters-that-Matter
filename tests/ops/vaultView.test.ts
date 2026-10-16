import { describe, expect, it } from 'vitest';
import { vaultView } from '../../src/ops/vaultView';
import { vault } from './snapshot';

describe('vaultView lookups', () => {
	const s = vault();
	const view = vaultView(s);

	it('finds every Matter by its path, the Inbox included', () => {
		expect([...view.matterByPath.keys()].sort()).toEqual(view.matters.map((m) => m.path).sort());
		for (const m of view.matters) expect(view.matterByPath.get(m.path)).toBe(m);
	});

	it('groups the Actions by their effective Matter, in the order of the Actions', () => {
		const items = view.actions.map((a) => a.item);
		const grouped = [...view.actionsByMatter.values()].flat();
		expect(grouped).toHaveLength(items.length);
		for (const [path, mine] of view.actionsByMatter) expect(mine).toEqual(items.filter((i) => i.effective.matterPath === path));
	});

	it('is built once per snapshot', () => {
		expect(vaultView(s)).toBe(view);
	});
});
