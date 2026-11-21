import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { workerAssetsManifest } from './src/service-worker-config';
import { collectWorkerAssetsFromDirectory } from './src/precache-workers';

const require = createRequire(import.meta.url);
const configDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
	// Local-only fallback. Vercel functions receive credentials from its env;
	// the ignored .env is never read by the serverless module.
	if (mode === 'development' && !process.env.VERCEL && !process.env.METRON_KEY && !process.env.metron_key) {
		const localEnv = loadEnv(mode, path.resolve(configDir, '../..'), '');
		if (localEnv.metron_key) process.env.metron_key = localEnv.metron_key;
	}

	return {
		plugins: [
			{
				name: 'metron-local-api',
				apply: 'serve',
				configureServer(server) {
					server.middlewares.use('/api/metron', require('../../api/metron.js'));
				}
			},
			sveltekit()
		],
		worker: { format: 'es' },
		optimizeDeps: { exclude: ['@jsquash/avif'] },
		build: {
			rollupOptions: {
				plugins: [
					{
						name: 'precache-worker-assets',
						writeBundle(options) {
							if (!options.dir) return;
							const assets = collectWorkerAssetsFromDirectory(options.dir);
							if (!assets.length) return;
							const manifest = path.join(options.dir, workerAssetsManifest);
							fs.mkdirSync(path.dirname(manifest), { recursive: true });
							fs.writeFileSync(manifest, JSON.stringify(assets));
						}
					}
				]
			}
		}
	};
});
