// Everything the inspector shows for one Action, read from the note and metadataCache.

import { TFile, type App } from 'obsidian';
import type { MattersSettings } from '../settings';
import { checklistItems, getDetails, type ChecklistItem } from '../model/body';
import { toYmd } from '../model/dates';
import type { ActionItem } from '../services/actionItems';
import { peopleList } from '../services/actionEdit';
import { linkText } from '../services/effective';
import type { MatterInfo } from '../services/boardModel';
import { actionItem, allMatters, linkedFile, linkedNotes } from './index';
import { frontmatterOf } from './notes';

/** A person link: the resolved note, or only the link text when it does not resolve. */
export interface PersonRef {
	name: string;
	/** Resolved path, or the link text; identifies the person for removal. */
	key: string;
	linktext: string;
	file: TFile | null;
}

export interface ActionDetails {
	file: TFile;
	item: ActionItem;
	matter: MatterInfo | undefined;
	matters: MatterInfo[];
	waitingOn: PersonRef | null;
	/** People without the waiting-on person, who shows in their own section. */
	people: PersonRef[];
	details: string;
	checklist: ChecklistItem[];
	linkedNotes: TFile[];
	attachments: TFile[];
}

function personRef(app: App, raw: unknown, sourcePath: string): PersonRef | null {
	const text = linkText(raw);
	if (!text) return null;
	const file = linkedFile(app, raw, sourcePath);
	return { name: file?.basename ?? text.split('/').pop() ?? text, key: file?.path ?? text, linktext: text, file };
}

/** Embedded files that are not notes. */
function attachments(app: App, file: TFile): TFile[] {
	const out = new Map<string, TFile>();
	for (const embed of app.metadataCache.getFileCache(file)?.embeds ?? []) {
		const target = app.metadataCache.getFirstLinkpathDest(embed.link.split('#')[0] ?? '', file.path);
		if (target && target.extension !== 'md') out.set(target.path, target);
	}
	return [...out.values()];
}

export async function readActionDetails(app: App, file: TFile, settings: MattersSettings): Promise<ActionDetails> {
	const fm = frontmatterOf(app, file) ?? {};
	const item = actionItem(app, file, settings);
	const matters = allMatters(app, settings, toYmd(new Date()));
	const content = await app.vault.cachedRead(file);

	const waitingOn = personRef(app, fm['mtm-waiting-on'], file.path);
	const people: PersonRef[] = [];
	for (const raw of peopleList(fm['mtm-people'])) {
		const ref = personRef(app, raw, file.path);
		if (ref && ref.key !== waitingOn?.key && !people.some((p) => p.key === ref.key)) people.push(ref);
	}

	const taskLines = (app.metadataCache.getFileCache(file)?.listItems ?? [])
		.filter((li) => li.task !== undefined)
		.map((li) => li.position.start.line);

	const exclude = new Set([item.effective.matterPath, ...people.map((p) => p.key)]);
	if (waitingOn) exclude.add(waitingOn.key);

	return {
		file,
		item,
		matter: matters.find((m) => m.path === item.effective.matterPath),
		matters,
		waitingOn,
		people,
		details: getDetails(content),
		checklist: checklistItems(content, taskLines),
		linkedNotes: linkedNotes(app, file, exclude),
		attachments: attachments(app, file),
	};
}
