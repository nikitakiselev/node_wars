import { defineConfig } from 'vitest/config';

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

export default defineConfig({
  base: basePath(),
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
