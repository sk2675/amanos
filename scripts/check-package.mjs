import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXPECTED = {
  name: "amanos",
  description: "A local-first decision memory for projects and code.",
  license: "Apache-2.0",
  repository: "git+https://github.com/sk2675/amanos.git",
  homepage: "https://amanos.dev",
  bugs: "https://github.com/sk2675/amanos/issues",
  engines: ">=20",
  bin: "dist/cli.js",
  registry: "https://registry.npmjs.org/",
};

export function validateManifest(manifest) {
  const violations = [];
  const expect = (actual, expected, field) => {
    if (actual !== expected) {
      violations.push(`${field} must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };

  expect(manifest.name, EXPECTED.name, "name");
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    violations.push(`version must be an exact stable semantic version, got ${JSON.stringify(manifest.version)}`);
  }
  if (manifest.private === true) {
    violations.push("private must not be true for the public CLI package");
  }
  expect(manifest.description, EXPECTED.description, "description");
  expect(manifest.license, EXPECTED.license, "license");
  expect(manifest.repository?.type, "git", "repository.type");
  expect(manifest.repository?.url, EXPECTED.repository, "repository.url");
  expect(manifest.homepage, EXPECTED.homepage, "homepage");
  expect(manifest.bugs?.url, EXPECTED.bugs, "bugs.url");
  expect(manifest.engines?.node, EXPECTED.engines, "engines.node");
  expect(manifest.bin?.amanos, EXPECTED.bin, "bin.amanos");
  if (JSON.stringify(manifest.files) !== JSON.stringify(["dist"])) {
    violations.push(`files must be ["dist"], got ${JSON.stringify(manifest.files)}`);
  }
  expect(manifest.publishConfig?.access, "public", "publishConfig.access");
  expect(manifest.publishConfig?.provenance, true, "publishConfig.provenance");
  expect(manifest.publishConfig?.registry, EXPECTED.registry, "publishConfig.registry");

  return violations;
}

export function validatePackFiles(files) {
  const paths = files.map((file) => file.path);
  const required = ["LICENSE", "README.md", "dist/cli.js", "package.json"];
  const violations = required
    .filter((path) => !paths.includes(path))
    .map((path) => `package is missing ${path}`);

  for (const path of paths) {
    if (!required.includes(path) && !/^dist\/.+\.js$/u.test(path)) {
      violations.push(`package contains unexpected file ${path}`);
    }
  }

  return violations;
}

export function validateReleaseTag(version, tag) {
  return tag === undefined || tag === `v${version}`
    ? []
    : [`release tag must be v${version}, got ${tag}`];
}

function runNpm(args, cwd) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("Run this check through npm so npm_execpath is available");
  }
  return execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
}

async function main() {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(await readFile(resolve(repository, "package.json"), "utf8"));
  const tagIndex = process.argv.indexOf("--tag");
  const tag = tagIndex === -1 ? undefined : process.argv[tagIndex + 1];
  const packResult = JSON.parse(runNpm(["pack", "--dry-run", "--json", "--ignore-scripts"], repository));
  const files = packResult[0]?.files;
  if (!Array.isArray(files)) {
    throw new Error("npm pack --dry-run did not report package contents");
  }

  const violations = [
    ...validateManifest(manifest),
    ...validatePackFiles(files),
    ...validateReleaseTag(manifest.version, tag),
  ];
  if (violations.length > 0) {
    console.error(["Package policy failed:", ...violations.map((item) => `- ${item}`)].join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(`Package policy passed for ${manifest.name}@${manifest.version} (${files.length} files).`);
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;
if (invokedAsScript) {
  await main();
}
