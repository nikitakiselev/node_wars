import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * On a GitHub project page the site is served from /<repo>/, not from the
 * domain root, so assets have to be requested with that prefix or the page
 * loads blank. Actions sets GITHUB_REPOSITORY, which gives us the repo name
 * without hardcoding it; locally and on a user page or custom domain the
 * base stays '/'.
 */
function basePath(): string {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) return '/';

  const [owner, name] = repository.split('/');
  if (!name) return '/';
  // <owner>.github.io is served from the root, unlike every other repo.
  if (name.toLowerCase() === `${owner?.toLowerCase()}.github.io`) return '/';
  return `/${name}/`;
}

/**
 * Stamps the service worker with a fingerprint of the build it belongs to.
 *
 * A browser replaces a service worker only when its file differs byte for
 * byte from the installed one. While the cache name was a number edited by
 * hand, every update turned on somebody remembering to change it — and a
 * forgotten bump is not a stale cache entry, it is a player who never gets
 * the new build at all, because no new worker means no reload.
 *
 * The fingerprint is taken over everything that was built, after the files in
 * `public` have been copied — they are not part of the bundle, so the
 * manifest and the icons would otherwise be invisible to it. A build that
 * changed anything gets a different worker; a build that changed nothing gets
 * the same one and costs nobody a reload.
 */
function stampWorker(): Plugin {
  let outDir = 'dist';

  return {
    name: 'stamp-worker',
    enforce: 'post',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const root = resolve(outDir);
      const worker = join(root, 'sw.js');
      if (!existsSync(worker)) return;

      const fingerprint = createHash('sha256');
      for (const file of built(root).sort()) {
        if (file === worker) continue;
        fingerprint.update(file.slice(root.length));
        fingerprint.update(readFileSync(file));
      }

      const stamped = readFileSync(worker, 'utf8').replace(
        '__BUILD__',
        fingerprint.digest('hex').slice(0, 12),
      );
      writeFileSync(worker, stamped);
    },
  };
}

/** Every file under a directory, deepest last, so the order is stable. */
function built(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...built(path));
    else found.push(path);
  }
  return found;
}

export default defineConfig({
  base: basePath(),
  plugins: [stampWorker()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
