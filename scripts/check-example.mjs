import { execFile, execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const demoDirectory = resolve(repository, "examples", "demo");
const expectedDirectory = resolve(demoDirectory, "expected");

/** Compares two multi-line texts and returns a short, readable diff. */
export function diffLines(actual, expected) {
  const actualLines = normaliseNewlines(actual).split("\n");
  const expectedLines = normaliseNewlines(expected).split("\n");
  const length = Math.max(actualLines.length, expectedLines.length);
  const differences = [];

  for (let index = 0; index < length; index += 1) {
    const actualLine = actualLines[index];
    const expectedLine = expectedLines[index];
    if (actualLine !== expectedLine) {
      differences.push(
        `  line ${index + 1}:\n    expected: ${JSON.stringify(expectedLine ?? "<missing>")}\n    actual:   ${JSON.stringify(actualLine ?? "<missing>")}`,
      );
    }
  }

  return differences;
}

/** Replaces the values that legitimately vary between runs with stable placeholders. */
export function normaliseOutput(text, workspaceRoot) {
  let normalised = normaliseNewlines(text);
  normalised = normalised.split(workspaceRoot).join("<WORKSPACE_ROOT>");
  // A workspace root can also appear with the opposite slash style inside
  // strings that were built with forward slashes regardless of platform.
  normalised = normalised.split(workspaceRoot.replace(/\\/g, "/")).join("<WORKSPACE_ROOT>");
  normalised = normalised.replace(/Completed in \d+ ms\./g, "Completed in <DURATION_MS> ms.");
  normalised = normalised.replace(/Erkannt: \d{4}-\d{2}-\d{2}/g, "Erkannt: <DATE>");
  return normalised;
}

function normaliseNewlines(text) {
  return text.replace(/\r\n/g, "\n");
}

async function createFixtureRepository(sourceDirectory, targetDirectory) {
  await cp(sourceDirectory, targetDirectory, { recursive: true });
  await execFileAsync("git", ["init", "--quiet", targetDirectory], { windowsHide: true });
  await execFileAsync("git", ["-C", targetDirectory, "add", "--all"], { windowsHide: true });
  await execFileAsync(
    "git",
    [
      "-C",
      targetDirectory,
      "-c",
      "user.name=Amanos Example",
      "-c",
      "user.email=amanos-example@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "Initial fixture",
    ],
    { windowsHide: true },
  );
}

async function ensureBuilt() {
  const cliEntry = resolve(repository, "dist", "cli.js");
  try {
    await stat(cliEntry);
  } catch {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) {
      throw new Error("dist/cli.js is missing. Run \"npm run build\" first (or run this check through npm).");
    }
    execFileSync(process.execPath, [npmCli, "run", "build"], {
      cwd: repository,
      stdio: "inherit",
      windowsHide: true,
    });
  }
}

async function runCli(args) {
  const cliEntry = resolve(repository, "dist", "cli.js");
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, ...args], {
    windowsHide: true,
  });
  return `${stdout}${stderr}`;
}

/** Sets up a temp workspace from the fixtures, runs init + scan and returns the raw transcript and DECISIONS.md. */
export async function runExample() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "amanos-example-"));
  try {
    await createFixtureRepository(
      join(demoDirectory, "repos", "website"),
      join(workspaceRoot, "website"),
    );
    await createFixtureRepository(join(demoDirectory, "repos", "app"), join(workspaceRoot, "app"));
    await cp(join(demoDirectory, "notes"), join(workspaceRoot, "notes"), { recursive: true });

    const initOutput = await runCli(["init", workspaceRoot]);
    const scanOutput = await runCli(["scan", workspaceRoot]);

    const transcript = [
      `$ amanos init ${workspaceRoot}`,
      initOutput.replace(/\n$/, ""),
      "",
      `$ amanos scan ${workspaceRoot}`,
      scanOutput.replace(/\n$/, ""),
      "",
    ].join("\n");

    const decisions = await readFile(join(workspaceRoot, "DECISIONS.md"), "utf8");

    return { workspaceRoot, transcript, decisions };
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function main() {
  await ensureBuilt();
  const { workspaceRoot, transcript, decisions } = await runExample();

  const actualTranscript = normaliseOutput(transcript, workspaceRoot);
  const actualDecisions = normaliseOutput(decisions, workspaceRoot);
  const expectedTranscript = normaliseNewlines(
    await readFile(join(expectedDirectory, "terminal-output.txt"), "utf8"),
  );
  const expectedDecisions = normaliseNewlines(
    await readFile(join(expectedDirectory, "DECISIONS.md"), "utf8"),
  );

  const violations = [
    ...diffLines(actualTranscript, expectedTranscript).map((line) => `terminal-output.txt${line}`),
    ...diffLines(actualDecisions, expectedDecisions).map((line) => `DECISIONS.md${line}`),
  ];

  if (violations.length > 0) {
    console.error(
      [
        "Example demo check failed: the real run diverged from examples/demo/expected/.",
        ...violations,
        "",
        "If this divergence is an intended behaviour change, regenerate the golden files",
        "in examples/demo/expected/ from a real run of examples/demo and commit them.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  console.log("Example demo check passed: init/scan output matches examples/demo/expected/.");
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;
if (invokedAsScript) {
  await main();
}
