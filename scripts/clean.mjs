import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputDirectory = fileURLToPath(new URL("../dist/", import.meta.url));
const repositoryDirectory = fileURLToPath(new URL("../", import.meta.url));

if (resolve(outputDirectory) === resolve(repositoryDirectory)) {
  throw new Error("Refusing to clean the repository root");
}

await rm(outputDirectory, { recursive: true, force: true });
