import { defineConfig } from 'vitest/config';

// Unit tests cover pure code only; the obsidian package has no runtime to import.
export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
	},
});
