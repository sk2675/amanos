import { readFile, readdir, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const siteDirectory = resolve(scriptDirectory, "..");
const defaultBuildDirectory = resolve(siteDirectory, "dist");

function attributes(tag) {
  const result = new Map();
  const pattern = /\b([:\w-]+)\s*=\s*(["'])(.*?)\2/gs;
  for (const match of tag.matchAll(pattern)) {
    result.set(match[1].toLowerCase(), match[3]);
  }
  return result;
}

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gis"))].map((match) => attributes(match[0]));
}

function pageRoute(buildDirectory, htmlFile) {
  const outputPath = relative(buildDirectory, htmlFile).split(sep).join("/");
  if (outputPath === "index.html") return "/";
  if (outputPath.endsWith("/index.html")) return `/${outputPath.slice(0, -"/index.html".length)}`;
  return `/${outputPath.slice(0, -extname(outputPath).length)}`;
}

async function filesIn(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesIn(path)));
    if (entry.isFile()) result.push(path);
  }
  return result;
}

async function existingFile(candidates) {
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

async function outputFileFor(buildDirectory, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  const diskPath = resolve(buildDirectory, `.${decodedPath}`);
  const rootPrefix = `${resolve(buildDirectory)}${sep}`;
  if (diskPath !== resolve(buildDirectory) && !diskPath.startsWith(rootPrefix)) return undefined;

  return existingFile([diskPath, `${diskPath}.html`, resolve(diskPath, "index.html")]);
}

function idsIn(html) {
  const ids = new Set();
  for (const tag of html.matchAll(/<[a-z][^>]*>/gis)) {
    const id = attributes(tag[0]).get("id");
    if (id) ids.add(id);
  }
  return ids;
}

function referencedUrls(html) {
  const references = [];
  for (const tag of html.matchAll(/<[a-z][^>]*>/gis)) {
    const values = attributes(tag[0]);
    for (const attribute of ["href", "src", "poster"]) {
      const value = values.get(attribute);
      if (value) references.push(value);
    }
    const srcset = values.get("srcset");
    if (srcset) {
      for (const candidate of srcset.split(",")) {
        const value = candidate.trim().split(/\s+/, 1)[0];
        if (value) references.push(value);
      }
    }
  }
  return references;
}

function cssUrls(content) {
  return [...content.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gis)].map((match) => match[2]);
}

function isIgnoredReference(reference) {
  return /^(?:data:|mailto:|tel:)/i.test(reference);
}

function canonicalFor(html) {
  const canonicalLinks = tags(html, "link").filter((link) =>
    link.get("rel")?.toLowerCase().split(/\s+/).includes("canonical"),
  );
  const robots = tags(html, "meta").find((meta) => meta.get("name")?.toLowerCase() === "robots")?.get("content") ?? "";
  const ogUrls = tags(html, "meta").filter((meta) => meta.get("property")?.toLowerCase() === "og:url");
  return { canonicalLinks, noindex: /\bnoindex\b/i.test(robots), ogUrls };
}

function normalizeRoute(pathname) {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/$/, "");
}

function describe(buildDirectory, file) {
  return relative(buildDirectory, file).split(sep).join("/");
}

export async function checkBuild({ buildDirectory = defaultBuildDirectory, site } = {}) {
  const errors = [];
  const allFiles = await filesIn(buildDirectory);
  const htmlFiles = allFiles.filter((file) => extname(file) === ".html");
  if (htmlFiles.length === 0) return ["dist: production build contains no HTML pages"];

  const configuredSite = site ?? (await import(pathToFileURL(resolve(siteDirectory, "astro.config.mjs")).href)).default.site;
  const siteUrl = new URL(configuredSite);
  if (siteUrl.protocol !== "https:" || siteUrl.pathname !== "/" || siteUrl.search || siteUrl.hash) {
    errors.push(`astro.config.mjs: site must be an HTTPS origin, received ${JSON.stringify(configuredSite)}`);
  }

  const htmlByFile = new Map();
  for (const file of htmlFiles) htmlByFile.set(file, await readFile(file, "utf8"));

  for (const [file, html] of htmlByFile) {
    const label = describe(buildDirectory, file);
    const route = pageRoute(buildDirectory, file);
    const { canonicalLinks, noindex, ogUrls } = canonicalFor(html);

    if (!noindex && canonicalLinks.length !== 1) {
      errors.push(`${label}: expected exactly one canonical link, found ${canonicalLinks.length}`);
    }
    if (canonicalLinks.length > 1) errors.push(`${label}: multiple canonical links are not allowed`);

    const canonical = canonicalLinks[0]?.get("href");
    if (canonical) {
      let canonicalUrl;
      try {
        canonicalUrl = new URL(canonical);
      } catch {
        errors.push(`${label}: canonical is not an absolute URL: ${JSON.stringify(canonical)}`);
      }
      if (canonicalUrl) {
        if (canonicalUrl.origin !== siteUrl.origin) {
          errors.push(`${label}: canonical origin ${canonicalUrl.origin} does not match configured site ${siteUrl.origin}`);
        }
        if (normalizeRoute(canonicalUrl.pathname) !== normalizeRoute(route) || canonicalUrl.search || canonicalUrl.hash) {
          errors.push(`${label}: canonical ${canonicalUrl.href} does not match route ${route}`);
        }
      }

      if (ogUrls.length !== 1 || ogUrls[0].get("content") !== canonical) {
        errors.push(`${label}: og:url must occur once and exactly match the canonical URL`);
      }
    }

    for (const reference of [...referencedUrls(html), ...cssUrls(html)]) {
      if (isIgnoredReference(reference)) continue;
      if (/^javascript:/i.test(reference)) {
        errors.push(`${label}: unsafe javascript URL ${JSON.stringify(reference)}`);
        continue;
      }

      let target;
      try {
        target = new URL(reference, new URL(route, siteUrl));
      } catch {
        errors.push(`${label}: malformed URL ${JSON.stringify(reference)}`);
        continue;
      }
      if (!["http:", "https:"].includes(target.protocol) || target.origin !== siteUrl.origin) continue;

      const targetFile = await outputFileFor(buildDirectory, target.pathname);
      if (!targetFile) {
        errors.push(`${label}: internal reference ${JSON.stringify(reference)} has no build output`);
        continue;
      }
      if (target.hash && extname(targetFile) === ".html") {
        const targetHtml = htmlByFile.get(targetFile) ?? (await readFile(targetFile, "utf8"));
        let fragment;
        try {
          fragment = decodeURIComponent(target.hash.slice(1));
        } catch {
          errors.push(`${label}: malformed URL fragment in ${JSON.stringify(reference)}`);
          continue;
        }
        if (fragment && !idsIn(targetHtml).has(fragment)) {
          errors.push(`${label}: fragment ${JSON.stringify(target.hash)} does not exist in ${describe(buildDirectory, targetFile)}`);
        }
      }
    }
  }

  for (const file of allFiles.filter((candidate) => extname(candidate) === ".css")) {
    const label = describe(buildDirectory, file);
    const browserPath = `/${label}`;
    for (const reference of cssUrls(await readFile(file, "utf8"))) {
      if (isIgnoredReference(reference) || reference.startsWith("#")) continue;
      let target;
      try {
        target = new URL(reference, new URL(browserPath, siteUrl));
      } catch {
        errors.push(`${label}: malformed CSS URL ${JSON.stringify(reference)}`);
        continue;
      }
      if (target.origin === siteUrl.origin && !(await outputFileFor(buildDirectory, target.pathname))) {
        errors.push(`${label}: referenced asset ${JSON.stringify(reference)} has no build output`);
      }
    }
  }

  return [...new Set(errors)].sort();
}

async function main() {
  const errors = await checkBuild();
  if (errors.length > 0) {
    console.error(["Website build validation failed:", ...errors.map((error) => `- ${error}`)].join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("Website links, canonicals, and referenced assets are valid.");
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;
if (invokedAsScript) await main();
