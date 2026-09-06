export const CANONICAL_ORIGIN = "https://www.amanos.dev";

export const PUBLIC_PATHS = ["/", "/docs", "/impressum", "/privacy"];

export function siteUrl(pathname) {
  return new URL(pathname, CANONICAL_ORIGIN).href;
}
