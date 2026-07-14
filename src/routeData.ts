import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

// Site-wide "under construction" banner. Starlight 0.41.x has no global
// `banner` config key — banners are per-page frontmatter — so we inject a
// default banner into every page's route data here instead.
export const onRequest = defineRouteMiddleware((context) => {
	const { starlightRoute } = context.locals;
	starlightRoute.entry.data.banner ??= {
		content:
			'🚧 These docs are under construction — content is incomplete and may change.',
	};
});
