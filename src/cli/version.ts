import { readFileSync } from "node:fs";

interface PackageManifest {
  readonly version?: string;
}

/** Reads the version from the package manifest next to the compiled output. */
export function version(): string {
  const manifestUrl = new URL("../../package.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as PackageManifest;
  return manifest.version ?? "0.0.0";
}
