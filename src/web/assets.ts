/** Resolve bundled public files under Vite's configured deployment path. */
export const publicAsset = (path: string) =>
  `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
