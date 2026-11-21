import fs from 'node:fs';
import path from 'node:path';

const workerPrefix = '_app/immutable/workers/';

function walk(directory: string, root: string, files: string[]): void {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		if (entry.isDirectory()) walk(file, root, files);
		else files.push(path.relative(root, file).split(path.sep).join('/'));
	}
}

/** Read every worker output after Vite's nested worker builds have finished. */
export function collectWorkerAssetsFromDirectory(outputDir: string): string[] {
	const root = path.join(outputDir, workerPrefix);
	if (!fs.existsSync(root)) return [];
	const files: string[] = [];
	walk(root, outputDir, files);
	return files.sort();
}
