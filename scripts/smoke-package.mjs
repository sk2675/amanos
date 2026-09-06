import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("Run this smoke test through npm so npm_execpath is available");
}

function runNpm(args, cwd) {
  return execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "amanos-package-smoke-"));

try {
  runNpm(["run", "build"], repository);

  const packOutput = runNpm(["pack", "--json", "--pack-destination", temporaryRoot], repository);
  const packResult = JSON.parse(packOutput);
  const filename = packResult[0]?.filename;
  if (typeof filename !== "string") {
    throw new Error("npm pack did not report a package filename");
  }

  const installDirectory = join(temporaryRoot, "consumer");
  await mkdir(installDirectory);
  await writeFile(
    join(installDirectory, "package.json"),
    `${JSON.stringify({ name: "amanos-smoke-consumer", private: true }, null, 2)}\n`,
    "utf8",
  );
  runNpm(
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(temporaryRoot, basename(filename))],
    installDirectory,
  );

  const help = runNpm(["exec", "--offline", "--yes=false", "--", "amanos", "--help"], installDirectory);

  for (const command of ["init", "scan", "watch", "status"]) {
    if (!help.includes(command)) {
      throw new Error(`installed amanos --help does not list ${command}`);
    }
  }

  const manifest = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  console.log(
    `Package smoke test passed: installed ${manifest.name}@${manifest.version} in a fresh directory and ran amanos --help.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
