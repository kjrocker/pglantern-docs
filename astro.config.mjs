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
					icon: 'codeberg',
					label: 'Codeberg',
					href: 'https://codeberg.org/kehvyn/horton-cli',
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
						{
							label: 'Examples',
							items: [
								{ label: 'Full-text search', slug: 'examples/search' },
								{ label: 'Commits and discussions', slug: 'examples/correlation' },
								{ label: 'Pagination', slug: 'examples/pagination' },
							],
						},
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
