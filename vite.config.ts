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
  // Stamped into the build so a running app can say which one it is. Asking
  // "is the phone on the new version?" from a screenshot is otherwise guesswork.
  define: {
    __BUILD_TIME__: JSON.stringify(
      new Date().toISOString().slice(0, 16).replace('T', ' '),
    ),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
