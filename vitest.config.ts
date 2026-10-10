import { defineConfig } from 'vitest/config';

// Sorting by name follows the runtime's locale, which Node takes from LC_ALL when it starts. Tests compare sorted
// output, so they run in British English whatever the machine's locale: set here, before the test workers start, so
// every worker inherits it.
const LOCALE = 'en_GB.UTF-8';
process.env.LC_ALL = LOCALE;

// Unit tests cover pure code only; the obsidian package has no runtime to import.
export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		env: { LC_ALL: LOCALE },
	},
});
