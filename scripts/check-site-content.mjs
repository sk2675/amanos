import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEXT_EXTENSIONS = new Set([".astro", ".css", ".html", ".js", ".jsx", ".md", ".mjs", ".svg", ".ts", ".tsx", ".txt"]);
const IGNORED_DIRECTORIES = new Set([".astro", "dist", "node_modules"]);
const EXPECTED_CONTACT = "simon.krumboeck@web.de";
const CLIENT_DATA_PROCESSING_PATTERNS = [
  [/@vercel\/(?:analytics|speed-insights)/iu, "Vercel client analytics"],
  [/\b(?:gtag|dataLayer|GoogleAnalyticsObject)\b|googletagmanager\.com|google-analytics\.com/iu, "Google Analytics or Tag Manager"],
  [/plausible\.io|\bplausible\s*\(/iu, "Plausible Analytics"],
  [/\b(?:matomo|posthog|mixpanel|hotjar|clarity|fathom|umami)\b/iu, "analytics or session tracking"],
  [/\b(?:document\.cookie|cookieStore|localStorage|sessionStorage)\b|\bSet-Cookie\b/iu, "cookie or browser storage access"],
  [/<(?:audio|iframe|img|link|script|source|video)\b[^>]*(?:href|src)\s*=\s*["']https?:\/\//iu, "automatically loaded third-party resource"],
  [/(?:@import\s+|url\(\s*)["']?https?:\/\//iu, "automatically loaded external CSS resource"],
];

const REQUIRED_PRIVACY_DISCLOSURES = [
  ["hosting provider", "Vercel Inc."],
  ["legal basis", "Art. 6 Abs. 1 lit. f DSGVO"],
  ["log retention", "Speicherdauer der Protokolldaten"],
  ["cookies", "Cookies und Speicher im Browser"],
  ["analytics", "Vercel Web Analytics"],
  ["performance telemetry", "Vercel Speed Insights"],
  ["external fonts", "keine Schriftarten von externen Servern"],
  ["data-subject rights", "Ihre Rechte"],
  ["supervisory authority", "Bayerische Landesamt für Datenschutzaufsicht"],
];

export function inspectSiteContent(content, file = "content") {
  const violations = [];

  for (const domain of ["amanto.dev"]) {
    if (content.toLowerCase().includes(domain)) {
      violations.push(`${file}: known incorrect domain ${domain}`);
    }
  }

  const placeholderPatterns = [
    /\[(?:vat[ -]?id|placeholder|insert[^\]]*|todo|tbd)\]/giu,
    /\b(?:changeme|lorem ipsum)\b/giu,
  ];
  for (const pattern of placeholderPatterns) {
    for (const match of content.matchAll(pattern)) {
      violations.push(`${file}: placeholder ${JSON.stringify(match[0])}`);
    }
  }

  return violations;
}

export function inspectClientDataProcessing(content, file = "content") {
  const violations = [];

  for (const [pattern, description] of CLIENT_DATA_PROCESSING_PATTERNS) {
    if (pattern.test(content)) {
      violations.push(
        `${file}: detected ${description}; update privacy.astro and explicitly review the content policy before release`,
      );
    }
  }

  return violations;
}

async function textFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
      files.push(...(await textFiles(path)));
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

export async function checkSiteContent(siteDirectory) {
  const violations = [];
  for (const file of await textFiles(siteDirectory)) {
    violations.push(...inspectSiteContent(await readFile(file, "utf8"), file));
  }

  const imprint = await readFile(resolve(siteDirectory, "src", "pages", "impressum.astro"), "utf8");
  if (!imprint.includes(`mailto:${EXPECTED_CONTACT}`) || !imprint.includes(`>${EXPECTED_CONTACT}<`)) {
    violations.push("impressum.astro: contact address and mailto link must match the approved address");
  }

  const privacy = await readFile(resolve(siteDirectory, "src", "pages", "privacy.astro"), "utf8");
  for (const [description, requiredText] of REQUIRED_PRIVACY_DISCLOSURES) {
    if (!privacy.includes(requiredText)) {
      violations.push(`privacy.astro: missing ${description} disclosure`);
    }
  }

  const base = await readFile(resolve(siteDirectory, "src", "layouts", "Base.astro"), "utf8");
  if (!base.includes('siteUrl("/privacy")') || !base.includes("<a href={privacy}>Privacy</a>")) {
    violations.push("Base.astro: every page footer must link to /privacy");
  }

  const pageDirectory = resolve(siteDirectory, "src", "pages");
  for (const page of (await textFiles(pageDirectory)).filter((file) => extname(file) === ".astro")) {
    const content = await readFile(page, "utf8");
    if (!content.includes("<Base")) {
      violations.push(`${page}: page must use Base.astro so the privacy footer link is present`);
    }
  }

  const sourceDirectory = resolve(siteDirectory, "src");
  for (const file of await textFiles(sourceDirectory)) {
    if (file === resolve(pageDirectory, "privacy.astro")) continue;
    violations.push(...inspectClientDataProcessing(await readFile(file, "utf8"), file));
  }

  const packageJson = JSON.parse(await readFile(resolve(siteDirectory, "package.json"), "utf8"));
  const dependencies = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
  for (const dependency of dependencies) {
    if (/(?:analytics|telemetry|tracking|speed-insights|posthog|mixpanel|hotjar|matomo|plausible)/iu.test(dependency)) {
      violations.push(
        `package.json: detected data-processing dependency ${dependency}; update privacy.astro and explicitly review the content policy before release`,
      );
    }
  }

  return violations;
}

async function main() {
  const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
  const siteDirectory = resolve(scriptDirectory, "..", "site");
  const violations = await checkSiteContent(siteDirectory);

  if (violations.length > 0) {
    console.error(["Site content policy failed:", ...violations.map((item) => `- ${item}`)].join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log("Site content policy passed.");
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;
if (invokedAsScript) {
  await main();
}
