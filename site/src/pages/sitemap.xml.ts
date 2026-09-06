import type { APIRoute } from "astro";

import { PUBLIC_PATHS, siteUrl } from "../../site-config.mjs";

export const prerender = true;

export const GET: APIRoute = () => {
  const urls = PUBLIC_PATHS.map((path) => `  <url><loc>${siteUrl(path)}</loc></url>`).join("\n");

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
