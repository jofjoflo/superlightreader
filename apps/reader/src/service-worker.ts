/// <reference lib="webworker" />
import { base, build, files, version } from '$service-worker';
import { offlineFallback, workerAssetsManifest } from './service-worker-config';

const worker = self as unknown as ServiceWorkerGlobalScope;
const cacheName = `superlight-${version}`;
const assets = [...build, ...files, offlineFallback];
const workerManifestUrl = new URL(`${base}/${workerAssetsManifest}`, worker.location.origin).toString();

async function precache(cache: Cache): Promise<void> {
	const manifest = await fetch(workerManifestUrl);
	if (!manifest.ok) throw new Error(`Worker asset manifest failed: ${manifest.status}`);
	const workerAssets = (await manifest.json()) as unknown;
	if (!Array.isArray(workerAssets) || !workerAssets.every((asset) => typeof asset === 'string')) {
		throw new Error('Worker asset manifest is invalid');
	}
	await cache.addAll([...assets, workerManifestUrl, ...workerAssets]);
}

worker.addEventListener('install', (event) => {
 event.waitUntil(caches.open(cacheName).then(precache).then(() => worker.skipWaiting()));
});
worker.addEventListener('activate', (event) => {
 event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('superlight-') && key !== cacheName).map((key) => caches.delete(key)))).then(() => worker.clients.claim()));
});
worker.addEventListener('fetch', (event) => {
 if (event.request.method !== 'GET' || event.request.headers.has('range') || new URL(event.request.url).origin !== worker.location.origin) return;
 if (event.request.mode === 'navigate') {
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(offlineFallback)) ?? Response.error()));
 } else {
  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
 }
});
