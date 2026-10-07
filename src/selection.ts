// The selected Action: shown in the inspector and highlighted in every view.

import { Events } from 'obsidian';

export class Selection extends Events {
	path: string | null = null;

	set(path: string | null): void {
		if (path === this.path) return;
		this.path = path;
		this.trigger('changed', path);
	}

	/** Follows a rename so the selection survives it. */
	rename(oldPath: string, newPath: string): void {
		if (this.path === oldPath) this.set(newPath);
	}
}
