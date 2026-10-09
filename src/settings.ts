// Settings types and defaults. Kept free of obsidian imports so tests can load it.

export const TONES = ['mint', 'sky', 'butter', 'lavender', 'peach', 'bubblegum', 'ink'] as const;
export type Tone = (typeof TONES)[number];

export type StatusCategory = 'open' | 'active' | 'closed';

export interface StatusDef {
	id: string;
	label: string;
	tone: Tone;
	category: StatusCategory;
	backlog?: boolean;
	done?: boolean;
}

export interface TypeDef {
	id: string;
	label: string;
	icon: string;
	tone: Tone;
	default?: boolean;
}

/** A sphere of life (Home, Work, Family) that groups related Matters. Order is the array's. */
export interface SphereDef {
	id: string;
	label: string;
	icon: string;
}

export interface MattersSettings {
	schemaVersion: number;
	setupDone: boolean;
	folders: {
		matters: string;
		actions: string;
		boards: string;
		people: string;
	};
	statuses: StatusDef[];
	types: TypeDef[];
	spheres: SphereDef[];
	inboxPath: string;
	boardPath: string;
	defaultInboxPosition: 'top' | 'bottom';
	showDone: boolean;
	weekStart: 'monday' | 'sunday';
	dateLanguages: ('en' | 'es')[];
	/** Opening a Matter note shows its overview. */
	openMattersAsOverview: boolean;
}

export const DEFAULT_SETTINGS: MattersSettings = {
	schemaVersion: 4,
	setupDone: false,
	folders: {
		matters: 'MTM/Matters',
		actions: 'MTM/Actions',
		boards: 'MTM/Boards',
		people: 'MTM/People',
	},
	statuses: [
		{ id: 'later', label: 'Later', tone: 'ink', category: 'open', backlog: true },
		{ id: 'next', label: 'Next', tone: 'sky', category: 'open' },
		{ id: 'doing', label: 'Doing', tone: 'butter', category: 'active' },
		{ id: 'waiting', label: 'Waiting', tone: 'lavender', category: 'active' },
		{ id: 'done', label: 'Done', tone: 'mint', category: 'closed', done: true },
	],
	types: [
		{ id: 'call', label: 'Call', icon: 'phone', tone: 'mint' },
		{ id: 'message', label: 'Message', icon: 'message-circle', tone: 'sky' },
		{ id: 'write', label: 'Write', icon: 'pencil-line', tone: 'butter', default: true },
		{ id: 'meet', label: 'Meet', icon: 'users', tone: 'lavender' },
		{ id: 'buy', label: 'Buy', icon: 'shopping-bag', tone: 'peach' },
		{ id: 'visit', label: 'Visit', icon: 'map-pin', tone: 'bubblegum' },
	],
	spheres: [],
	inboxPath: 'MTM/Matters/Inbox.md',
	boardPath: 'MTM/Boards/Matters.base',
	defaultInboxPosition: 'top',
	showDone: true,
	weekStart: 'monday',
	dateLanguages: ['en', 'es'],
	openMattersAsOverview: true,
};
