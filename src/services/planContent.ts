// A new note's content: what a plan's create writes after Obsidian has written its frontmatter.

/**
 * The content of a new note once its body follows the frontmatter. The body is written after the frontmatter, never
 * before it, so a body that starts with a block of dashes can't pass for the note's properties.
 */
export function withBody(content: string, body: string): string {
	if (!body) return content;
	if (!content) return body;
	return content.endsWith('\n') ? content + body : `${content}\n${body}`;
}
