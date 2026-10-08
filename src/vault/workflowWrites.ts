// Moving Actions off a status or type, and Matters off a Sphere, that is being deleted. Notes first; the caller saves settings last.

import type { App, TFile } from 'obsidian';
import type { StatusDef } from '../settings';
import { applyStatus } from '../services/completion';
import { toYmd } from '../model/dates';
import { frontmatterOf, notesOfKind, type Frontmatter } from './notes';

/** Actions whose raw value for the key is exactly the ID. */
export function actionsUsing(app: App, key: 'mtm-status' | 'mtm-type', id: string): TFile[] {
	return notesOfKind(app, 'action').filter((f) => frontmatterOf(app, f)?.[key] === id);
}

export async function moveStatus(app: App, files: readonly TFile[], from: StatusDef, to: StatusDef): Promise<number> {
	const today = toYmd(new Date());
	for (const file of files) {
		await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => applyStatus(fm, to, from.category, today));
	}
	return files.length;
}

export async function moveType(app: App, files: readonly TFile[], toId: string): Promise<number> {
	for (const file of files) {
		await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
			fm['mtm-type'] = toId;
		});
	}
	return files.length;
}

/** Matters whose raw `mtm-sphere` is exactly the ID. */
export function mattersInSphere(app: App, id: string): TFile[] {
	return notesOfKind(app, 'matter').filter((f) => frontmatterOf(app, f)?.['mtm-sphere'] === id);
}

/** Moves Matters to another Sphere, or to none when `toId` is null. */
export async function moveSphere(app: App, files: readonly TFile[], toId: string | null): Promise<number> {
	for (const file of files) {
		await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
			if (toId) fm['mtm-sphere'] = toId;
			else delete fm['mtm-sphere'];
		});
	}
	return files.length;
}
