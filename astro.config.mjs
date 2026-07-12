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
							label: 'Concepts',
							items: [
								{ label: 'Authentication', slug: 'concepts/authentication' },
								{ label: 'Pagination', slug: 'concepts/pagination' },
								{ label: 'Message-Ids', slug: 'concepts/message-ids' },
								{ label: 'Threading', slug: 'concepts/threading' },
								{ label: 'Errors', slug: 'concepts/errors' },
							],
						},
						{ label: 'Search guide', slug: 'guides/search' },
						{ label: 'Correlation guide', slug: 'guides/correlation' },
						{ label: 'Cookbook', slug: 'cookbook' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'CLI overview', slug: 'cli' },
						{ label: 'CLI commands', slug: 'cli/commands' },
						...openAPISidebarGroups,
					],
				},
				{
					label: 'Policies',
					items: [
						{ label: 'Versioning', slug: 'policies/versioning' },
						{ label: 'Error codes', slug: 'policies/errors' },
						{ label: 'Data & limits', slug: 'policies/data' },
					],
				},
			],
		}),
	],
});
