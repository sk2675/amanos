import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_PATHS = ["/", "/docs", "/impressum"];
const MAX_REDIRECTS = 5;

function attributes(tag) {
  const result = new Map();
  for (const match of tag.matchAll(/\b([:\w-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    result.set(match[1].toLowerCase(), match[3]);
  }
  return result;
}

function metadata(html) {
  const links = [...html.matchAll(/<link\b[^>]*>/gis)].map((match) => attributes(match[0]));
  const metas = [...html.matchAll(/<meta\b[^>]*>/gis)].map((match) => attributes(match[0]));
  const canonicals = links.filter((link) => link.get("rel")?.toLowerCase().split(/\s+/).includes("canonical"));
  const ogUrls = metas.filter((meta) => meta.get("property")?.toLowerCase() === "og:url");
  return { canonicals, ogUrls };
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizedPath(pathname) {
  return pathname === "/" ? pathname : pathname.replace(/\/$/, "");
}

async function fetchWithoutExternalRedirects(url, headers) {
  let current = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(current, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    if (!location) throw new Error(`${current.pathname}: redirect ${response.status} has no Location header`);
    const next = new URL(location, current);
    if (next.origin !== url.origin) {
      throw new Error(`${current.pathname}: preview redirected outside the deployment to ${next.origin}`);
    }
    current = next;
  }
  throw new Error(`${url.pathname}: exceeded ${MAX_REDIRECTS} redirects`);
}

export async function smokePreview({
  baseUrl,
  paths = DEFAULT_PATHS,
  bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
} = {}) {
  if (!baseUrl) throw new Error("Pass the preview deployment URL as an argument or PREVIEW_URL.");
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && isLoopback(base.hostname))) {
    throw new Error("Preview URL must use HTTPS (HTTP is allowed only for a local smoke test).");
  }
  if (bypassSecret && !base.hostname.endsWith(".vercel.app")) {
    throw new Error("Refusing to send the Vercel bypass secret to a non-Vercel host.");
  }

  const headers = { "user-agent": "amanos-preview-smoke/1.0" };
  if (bypassSecret) headers["x-vercel-protection-bypass"] = bypassSecret;

  let canonicalOrigin;
  for (const path of paths) {
    const requested = new URL(path, base);
    const response = await fetchWithoutExternalRedirects(requested, headers);
    if (response.status !== 200) throw new Error(`${path}: expected HTTP 200, received ${response.status}`);
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      throw new Error(`${path}: expected an HTML response`);
    }

    const html = await response.text();
    if (!/<main\b[^>]*\bid=["']content["']/i.test(html) || !/<title>[^<]+<\/title>/i.test(html)) {
      throw new Error(`${path}: response is not a rendered Amanos page`);
    }

    const { canonicals, ogUrls } = metadata(html);
    if (canonicals.length !== 1) throw new Error(`${path}: expected exactly one canonical URL`);
    const canonical = canonicals[0].get("href");
    const canonicalUrl = new URL(canonical);
    if (canonicalUrl.protocol !== "https:") throw new Error(`${path}: canonical URL must use HTTPS`);
    if (normalizedPath(canonicalUrl.pathname) !== normalizedPath(requested.pathname)) {
      throw new Error(`${path}: canonical path ${canonicalUrl.pathname} does not match the requested route`);
    }
    if (ogUrls.length !== 1 || ogUrls[0].get("content") !== canonical) {
      throw new Error(`${path}: og:url must occur once and match the canonical URL`);
    }
    canonicalOrigin ??= canonicalUrl.origin;
    if (canonicalUrl.origin !== canonicalOrigin) throw new Error(`${path}: canonical origins are inconsistent`);
  }

  return { canonicalOrigin, pathsChecked: paths.length };
}

async function main() {
  const baseUrl = process.argv[2] ?? process.env.PREVIEW_URL;
  const paths = process.env.SMOKE_PATHS?.split(",").map((path) => path.trim()).filter(Boolean) ?? DEFAULT_PATHS;
  const attempts = Number.parseInt(process.env.SMOKE_ATTEMPTS ?? "4", 10);
  const retryDelay = Number.parseInt(process.env.SMOKE_RETRY_DELAY_MS ?? "2000", 10);

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await smokePreview({ baseUrl, paths });
      console.log(`Preview smoke test passed for ${result.pathsChecked} routes (canonical origin: ${result.canonicalOrigin}).`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(`Preview smoke attempt ${attempt}/${attempts} failed: ${error.message}`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelay * attempt));
      }
    }
  }
  throw lastError;
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;
if (invokedAsScript) await main();
