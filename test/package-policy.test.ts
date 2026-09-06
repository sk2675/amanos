import { describe, expect, it } from "vitest";

import {
  validateManifest,
  validatePackFiles,
  validateReleaseTag,
} from "../scripts/check-package.mjs";

const validManifest = {
  name: "amanos",
  version: "0.1.0",
  description: "A local-first decision memory for projects and code.",
  license: "Apache-2.0",
  repository: { type: "git", url: "git+https://github.com/sk2675/amanos.git" },
  homepage: "https://amanos.dev",
  bugs: { url: "https://github.com/sk2675/amanos/issues" },
  engines: { node: ">=20" },
  bin: { amanos: "dist/cli.js" },
  files: ["dist"],
  publishConfig: {
    access: "public",
    provenance: true,
    registry: "https://registry.npmjs.org/",
  },
};

describe("package policy", () => {
  it("accepts the release manifest", () => {
    expect(validateManifest(validManifest)).toEqual([]);
  });

  it("rejects private and inconsistent package metadata", () => {
    expect(validateManifest({ ...validManifest, private: true, license: "ISC" })).toEqual([
      "private must not be true for the public CLI package",
      'license must be "Apache-2.0", got "ISC"',
    ]);
  });

  it("allows only the manifest, documentation, license, and compiled JavaScript", () => {
    expect(
      validatePackFiles([
        { path: "LICENSE" },
        { path: "README.md" },
        { path: "dist/cli.js" },
        { path: "dist/cli/run.js" },
        { path: "package.json" },
      ]),
    ).toEqual([]);
    expect(
      validatePackFiles([
        { path: "LICENSE" },
        { path: "README.md" },
        { path: "dist/cli.js" },
        { path: "dist/cli.js.map" },
        { path: "package.json" },
      ]),
    ).toContain("package contains unexpected file dist/cli.js.map");
  });

  it("requires the release tag to match the package version", () => {
    expect(validateReleaseTag("0.1.0", "v0.1.0")).toEqual([]);
    expect(validateReleaseTag("0.1.0", "v1.0.0")).toEqual([
      "release tag must be v0.1.0, got v1.0.0",
    ]);
  });
});
