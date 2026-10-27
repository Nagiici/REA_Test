// Vite supplies the same base used by the generated HTML and bundles.
// Native Node tests have no Vite environment and keep the root-path default.
const base = import.meta.env?.BASE_URL ?? '/';

export function assetUrl(path) {
  return `${base}assets/${path}`;
}
