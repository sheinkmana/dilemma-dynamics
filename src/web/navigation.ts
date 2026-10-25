export type Page = 'play' | 'analysis' | 'replay' | 'results' | 'recreational';

/** Existing bookmarks keep their section while the app has two primary tabs. */
export function pageForHash(hash: string): Page {
  const route = hash.replace(/^#/, '');
  return ['analysis', 'replay', 'results', 'recreational'].includes(route)
    ? (route as Page)
    : 'play';
}

export const primaryPage = (page: Page) =>
  page === 'analysis' ? 'play' : page === 'replay' ? 'results' : page;
