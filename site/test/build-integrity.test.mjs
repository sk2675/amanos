import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { checkBuild } from "../scripts/check-build.mjs";

const temporaryDirectories = [];

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { force: true, recursive: true })));
});

async function fixture({ broken = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "amanos-site-check-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "docs"));

  await writeFile(
    join(directory, "index.html"),
    `<!doctype html><html><head>
      <link rel="canonical" href="https://www.amanos.dev/">
      <meta property="og:url" content="https://www.amanos.dev/">
      <link rel="stylesheet" href="/styles.css">
    </head><body><a href="${broken ? "/missing#guide" : "/docs#guide"}">Docs</a>
      <img src="${broken ? "/missing.svg" : "/logo.svg"}" alt="">
    </body></html>`,
  );
  await writeFile(
    join(directory, "docs", "index.html"),
    `<!doctype html><html><head>
      <link rel="canonical" href="https://www.amanos.dev/${broken ? "elsewhere" : "docs"}">
      <meta property="og:url" content="https://www.amanos.dev/${broken ? "elsewhere" : "docs"}">
    </head><body><main id="guide">Guide</main></body></html>`,
  );
  await writeFile(join(directory, "styles.css"), `.mark { background: url("${broken ? "/gone.svg" : "/logo.svg"}"); }`);
  await writeFile(join(directory, "logo.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
  return directory;
}

describe("production build integrity", () => {
  it("accepts valid internal links, fragments, canonicals, and assets", async () => {
    const buildDirectory = await fixture();
    assert.deepEqual(await checkBuild({ buildDirectory, site: "https://www.amanos.dev" }), []);
  });

  it("reports broken routes, canonical paths, and referenced assets", async () => {
    const buildDirectory = await fixture({ broken: true });
    const errors = await checkBuild({ buildDirectory, site: "https://www.amanos.dev" });

    assert(errors.some((error) => error.includes("canonical") && error.includes("does not match route")));
    assert(errors.some((error) => error.includes("/missing#guide") && error.includes("no build output")));
    assert(errors.some((error) => error.includes("/missing.svg") && error.includes("no build output")));
    assert(errors.some((error) => error.includes("/gone.svg") && error.includes("no build output")));
  });
});
