// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';

// https://astro.build/config
export default defineConfig({
	site: 'https://docs.pglantern.com',
	integrations: [
		starlight({
			title: 'pgLantern',
			routeMiddleware: './src/routeData.ts',
			logo: {
				src: './src/assets/pglantern-logo.svg',
				alt: 'pgLantern',
			},
			favicon: '/favicon.svg',
			customCss: ['./src/styles/custom.css'],
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/kjrocker/pglantern-cli',
				},
			],
			plugins: [
				starlightOpenAPI([
					{
						base: 'reference/api',
						schema: './src/openapi/pglantern.json',
						sidebar: { label: 'API reference', collapsed: false },
					},
				]),
			],
			sidebar: [
				{
					label: 'Learn',
					items: [
						{ label: 'Getting started', slug: 'getting-started' },
						{ label: 'Authentication', slug: 'guides/authentication' },
						{ label: 'Install the CLI', slug: 'guides/cli' },
						{ label: 'What you can ask', slug: 'capabilities' },
						{ label: 'Connect via MCP', slug: 'guides/mcp' },
						{
							label: 'Examples',
							items: [
								{ label: 'Full-text search', slug: 'examples/search' },
								{ label: 'Commits and discussions', slug: 'examples/correlation' },
								{ label: 'Pagination', slug: 'examples/pagination' },
							],
						},
						{ label: 'Roadmap', slug: 'roadmap' },
					],
				},
				{
					label: 'Reference',
					items: [...openAPISidebarGroups],
				},
			],
		}),
	],
});
