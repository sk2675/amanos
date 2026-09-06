import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEXT_EXTENSIONS = new Set([".astro", ".css", ".html", ".md", ".svg", ".txt"]);
const IGNORED_DIRECTORIES = new Set([".astro", "dist", "node_modules"]);
const EXPECTED_CONTACT = "simon.krumboeck@web.de";

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
