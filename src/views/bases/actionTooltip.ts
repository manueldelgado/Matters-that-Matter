// The hover text for an Action in the calendar and timeline.

import { STRINGS } from '../../strings';
import { dayLabel, type Ymd } from '../../model/dates';
import type { ActionItem } from '../../services/actionItems';

/** "Confirm the worktop · Kitchen renovation · Call · Today 10:00" (or a day range for a bar). */
export function actionTooltip(item: ActionItem, matter: string, today: Ymd): string {
	const c = STRINGS.calendar;
	const parts = [item.title, matter, item.effective.type.label];
	const { start, due } = item;
	if (start && due && start.date < due.date) parts.push(`${dayLabel(start.date, today)}${c.rangeSep}${dayLabel(due.date, today)}`);
	else {
		const d = due ?? start;
		if (d) parts.push(d.time ? `${dayLabel(d.date, today)} ${d.time}` : dayLabel(d.date, today));
	}
	return parts.join(c.tipSep);
}
