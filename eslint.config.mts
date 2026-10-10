import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'cli/dist',
		'cli/package.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json', 'scripts/*.mjs', 'cli/build.mjs'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Node scripts, the test configuration and the tests that read files or run scripts: they never ship in the plugin.
		files: ['scripts/**', 'tests/scripts/**', 'tests/schema/**', 'tests/files/**', 'tests/skills/**', 'vitest.config.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/hardcoded-config-path': 'off',
		},
	},
	{
		// The command line runs in Node and reads the vault's configuration folder by name; it never ships in the plugin.
		files: ['cli/src/**', 'cli/build.mjs', 'tests/cli/**'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/hardcoded-config-path': 'off',
			// Its build tools are the plugin's dev dependencies; its package has none.
			'import/no-extraneous-dependencies': ['warn', { packageDir: [import.meta.dirname, `${import.meta.dirname}/cli`] }],
		},
	},
	{
		// The MCP library marks its low-level server as deprecated in favour of a higher-level one that wants schemas in
		// its own schema library; the tools here are plain JSON Schemas, which the low-level server takes as they are.
		files: ['cli/src/mcp.ts'],
		rules: {
			'@typescript-eslint/no-deprecated': 'off',
		},
	},
	{
		// They import their own bundle of the plugin's source from a data URL; the rule guards against injected markup.
		files: ['scripts/fixture-vault.mjs', 'scripts/perf-files.mjs'],
		rules: {
			'no-unsanitized/method': 'off',
		},
	},
);
