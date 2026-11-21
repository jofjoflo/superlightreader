import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Ren SPA: allt körs i webbläsaren, ingen backend. Funkar på Vercel/Netlify/valfri statisk host.
		adapter: adapter({ fallback: 'index.html' })
	}
};

export default config;
