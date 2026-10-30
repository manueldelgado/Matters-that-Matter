# Routines

Four things people often ask an assistant for that take several calls, done the same way each time. Each uses only the MCP tools of Matters that Matter (or the same commands on the command line). Read a routine before you start it.

For all of them:

- Read first, then propose; write only what the user accepts. Ask once for a batch of changes rather than once per Action, but apply them one Action at a time.
- Report what each write changed, briefly, and finish with a short summary.
- Use the user's words for their statuses and types (labels from `get_workflow`), and the plugin's words for the rest: Action, Matter, Inbox, Sphere.
- Some steps can only be done in Obsidian. Each routine ends by saying which.

## Go through the Inbox

When the user asks to sort, clear or go through their Inbox, or `get_today` shows Actions waiting there.

1. `list_matters`: the Matters an Action could go to (the Inbox is one of them). `get_workflow`: the statuses and types.
2. `list_actions` with the Inbox as the Matter. For an Action whose title says little, `get_action` gives its details.
3. For each Action, propose a Matter that exists, a type, and a status (the backlog status unless the user is about to do it); add a due date only if the title or details give one. When no Matter fits, say so: leave it in the Inbox, or suggest a new Matter, which you add with `add_matter` only on the user's yes.
4. Show the proposals together, as a short list, and ask. The user may accept them all, change some, or skip some.
5. Apply what was accepted with `update_action`. An Action that turns out to be done already: `mark_as_done`. One the user wants gone: tell them to delete it in Obsidian; nothing is deleted through the tools.
6. Say how many Actions went where, and how many are still in the Inbox.

In Obsidian: deleting Actions. The plugin's Process Inbox does this one Action at a time, for anyone who prefers it there.

## What am I waiting on

When the user asks what they are waiting on, from whom, or what to chase.

1. `list_actions` with only Actions waiting on someone (add a person to ask about one). `get_today` also lists the longest waits.
2. Group them by person. For each Action: its title, its Matter, since when it has been waiting, and its due date if it has one.
3. Suggest what to chase first: the longest waits, and those due soon or late. If the user wants, draft the reminder; sending it is theirs.
4. Change nothing unless asked. When the user says someone has answered, `update_action` removes who it is waiting on (and moves it on if they say so); when it's finished, `mark_as_done`.

In Obsidian: nothing.

## Plan my day

When the user asks what to do today, what's on, or how their day looks.

1. `get_today`. Its `date` is today for everything that follows.
2. Late Actions first, then today's: timed ones in time order (they are appointments), then the rest by priority.
3. Suggest no more than three to do first, and say why (late, high priority, someone waiting on it).
4. Offer, don't do: moving a late Action to another day (`update_action`), marking one done, adding something the user mentions.
5. If Actions wait in the Inbox, say how many and offer to go through them. If reviews are due, mention them.

In Obsidian: nothing.

## This week's review

When the user asks to review their week, see what they got done, or get ready for the next one.

1. **Done**: `list_actions` with done Actions included; keep those completed in the last seven days, grouped by Matter.
2. **Slipped**: `get_today` for the late Actions; ask about each: a new date, done after all, or no longer wanted.
3. **Coming**: `list_actions` due from today to seven days ahead.
4. **Waiting**: as in "What am I waiting on", briefly.
5. **Matters to review**: the Matters `get_today` lists as due for review, each with its latest review note ("Last time: …"). For each, `list_actions` in that Matter: does it have an Action to do next? If not, propose one and add it with `add_action` on the user's yes. Ask whether its outcome, state or review rhythm still hold, and change them with `update_matter` if the user says so.
6. When the user has been through a Matter, mark it with `mark_as_reviewed` on their yes, with a line for next time if they give one (what was decided, what to look at next).
7. Apply what the user accepted, one Action or Matter at a time, then sum up the week in a few lines.

In Obsidian: renaming or deleting a Matter.
