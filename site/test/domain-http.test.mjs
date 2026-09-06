import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { request } from "node:http";
import { after, before, describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CANONICAL_ORIGIN, PUBLIC_PATHS, siteUrl } from "../site-config.mjs";

const siteDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(siteDirectory, "..");
const canonicalHost = new URL(CANONICAL_ORIGIN).host;
const redirectHost = "amanos.dev";
const vercelConfig = JSON.parse(await readFile(resolve(repository, "vercel.json"), "utf8"));
const hostRedirect = vercelConfig.redirects?.find((rule) =>
  rule.has?.some((condition) => condition.type === "host" && condition.value === redirectHost),
);

function redirectLocation(pathname) {
  assert.deepEqual(hostRedirect, {
    source: "/:path*",
    has: [{ type: "host", value: redirectHost }],
    destination: `${CANONICAL_ORIGIN}/:path*`,
    permanent: true,
  });

  return hostRedirect.destination.replace(":path*", pathname.slice(1));
}

function outputFile(pathname) {
  if (pathname === "/") return resolve(siteDirectory, "dist", "index.html");
  if (pathname.endsWith(".xml") || pathname.endsWith(".txt")) {
    return resolve(siteDirectory, "dist", pathname.slice(1));
  }
  return resolve(siteDirectory, "dist", pathname.slice(1), "index.html");
}

function contentType(pathname) {
  if (pathname.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (pathname.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "text/html; charset=utf-8";
}

let server;
let port;

before(async () => {
  server = createServer(async (incoming, response) => {
    const url = new URL(incoming.url ?? "/", "http://localhost");
    const host = incoming.headers.host;

    if (host === redirectHost) {
      response.writeHead(hostRedirect?.permanent ? 308 : 307, {
        location: redirectLocation(url.pathname),
      });
      response.end();
      return;
    }

    if (host !== canonicalHost) {
      response.writeHead(404).end();
      return;
    }

    try {
      const body = await readFile(outputFile(url.pathname));
      response.writeHead(200, { "content-type": contentType(url.pathname) });
      response.end(body);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      response.writeHead(404).end();
    }
  });

  await new Promise((resolveListening) => server.listen(0, "127.0.0.1", resolveListening));
  const address = server.address();
  assert(address && typeof address === "object");
  port = address.port;
});

after(async () => {
  await new Promise((resolveClosed, reject) => {
    server.close((error) => (error ? reject(error) : resolveClosed()));
  });
});

function get(pathname, host) {
  return new Promise((resolveResponse, reject) => {
    const outgoing = request(
      { hostname: "127.0.0.1", port, path: pathname, headers: { host } },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolveResponse({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode,
          });
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function metadata(html, attribute, value) {
  const tag = html.match(new RegExp(`<[^>]+${attribute}=["']${value}["'][^>]*>`, "i"))?.[0];
  assert(tag, `missing ${attribute}=${value}`);
  return tag.match(/(?:href|content)=["']([^"']+)["']/i)?.[1];
}

describe("canonical host over HTTP", () => {
  for (const pathname of PUBLIC_PATHS) {
    it(`redirects ${redirectHost}${pathname} directly and permanently`, async () => {
      const redirected = await get(pathname, redirectHost);

      assert.equal(redirected.status, 308);
      assert.equal(redirected.headers.location, siteUrl(pathname));

      const destination = await get(new URL(redirected.headers.location).pathname, canonicalHost);
      assert.equal(destination.status, 200);
      assert.equal(destination.headers.location, undefined);
    });

    it(`serves canonical metadata and absolute links for ${canonicalHost}${pathname}`, async () => {
      const response = await get(pathname, canonicalHost);
      const expectedUrl = siteUrl(pathname);

      assert.equal(response.status, 200);
      assert.equal(response.headers.location, undefined);
      assert.equal(metadata(response.body, "rel", "canonical"), expectedUrl);
      assert.equal(metadata(response.body, "property", "og:url"), expectedUrl);

      const links = [...response.body.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(
        (match) => match[1],
      );
      const relativeInternalLinks = links.filter(
        (href) => !href.startsWith("#") && !/^(?:https?:|mailto:)/i.test(href),
      );
      assert.deepEqual(relativeInternalLinks, []);

      for (const href of links.filter((link) => /^https?:/i.test(link))) {
        const linkHost = new URL(href).host;
        if (linkHost === redirectHost || linkHost === canonicalHost) {
          assert.equal(linkHost, canonicalHost);
        }
      }
    });
  }

  it("publishes only canonical URLs in the sitemap and robots.txt", async () => {
    const sitemap = await get("/sitemap.xml", canonicalHost);
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.headers["content-type"], /^application\/xml/);
    assert.deepEqual(
      [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]),
      PUBLIC_PATHS.map(siteUrl),
    );
    assert.doesNotMatch(sitemap.body, /https:\/\/amanos\.dev/);

    const robots = await get("/robots.txt", canonicalHost);
    assert.equal(robots.status, 200);
    assert.match(robots.body, new RegExp(`Sitemap: ${siteUrl("/sitemap.xml")}`));
  });
});
