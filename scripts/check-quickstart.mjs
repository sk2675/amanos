import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Runs the exact commands documented in docs/quickstart.md, in a fresh
// temporary workspace, and asserts that the real CLI output and the real
// resulting DECISIONS.md content match what the quickstart doc claims.
//
// The doc is not machine-oriented markup: this script relies on the fixed
// order and count of fenced code blocks in docs/quickstart.md. If the doc's
// structure changes, update FENCE_ROLES below to match.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(repository, "dist", "cli.js");
const docPath = resolve(repository, "docs", "quickstart.md");

const FENCE_ROLES = [
  "install-commands", // npm install / build / link / --version (not executed here)
  "init-command", // amanos init "$WORKSPACE"
  "init-output", // expected stdout of init
  "decisions-after-init", // expected DECISIONS.md right after init
  "sample-note", // content of notes/api.md
  "scan-command", // amanos scan "$WORKSPACE"
  "scan-output", // expected stdout of scan
  "decisions-after-scan", // expected DECISIONS.md after scan
  "status-command", // amanos status "$WORKSPACE"
  "status-output", // expected stdout of status
  "cleanup-command", // rm -rf cleanup snippet
];

function extractFences(markdown) {
  const fences = [];
  const pattern = /```([a-zA-Z0-9]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(markdown)) !== null) {
    fences.push({ lang: match[1], content: match[2] });
  }
  return fences;
}

function runCli(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, status: 0 };
  } catch (error) {
    return { stdout: error.stdout ?? "", status: error.status ?? 1 };
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

// Builds a line-matching regex from a doc line that may contain placeholder
// tokens (e.g. "<MS>"). Everything outside the placeholders is treated as a
// literal and escaped; only the placeholder's own replacement is inserted as
// a live regex fragment.
function lineToRegex(expectedLine, placeholders) {
  if (placeholders.length === 0) {
    return new RegExp(`^${escapeRegex(expectedLine)}$`);
  }

  const tokens = placeholders.map(([token]) => token);
  const splitPattern = new RegExp(`(${tokens.map(escapeRegex).join("|")})`, "gu");
  const parts = expectedLine.split(splitPattern);
  const pattern = parts
    .map((part) => {
      const placeholder = placeholders.find(([token]) => token === part);
      return placeholder ? placeholder[1] : escapeRegex(part);
    })
    .join("");
  return new RegExp(`^${pattern}$`);
}

function assertLinesInclude(actual, expectedTemplate, placeholders, label, violations) {
  const actualLines = actual.trim().split(/\r?\n/);
  const expectedLines = expectedTemplate.trim().split(/\r?\n/);

  if (actualLines.length !== expectedLines.length) {
    violations.push(
      `${label}: expected ${expectedLines.length} line(s), got ${actualLines.length}.\n--- expected ---\n${expectedTemplate}\n--- actual ---\n${actual}`,
    );
    return;
  }

  for (let i = 0; i < expectedLines.length; i += 1) {
    const regex = lineToRegex(expectedLines[i], placeholders);
    if (!regex.test(actualLines[i])) {
      violations.push(
        `${label}: line ${i + 1} did not match.\nexpected pattern: ${expectedLines[i]}\nactual: ${actualLines[i]}`,
      );
    }
  }
}

async function main() {
  const violations = [];

  const markdown = await readFile(docPath, "utf8");
  const fences = extractFences(markdown);

  if (fences.length !== FENCE_ROLES.length) {
    throw new Error(
      `docs/quickstart.md structure changed: expected ${FENCE_ROLES.length} fenced code blocks, found ${fences.length}. Update scripts/check-quickstart.mjs FENCE_ROLES to match.`,
    );
  }

  const blocks = {};
  FENCE_ROLES.forEach((role, index) => {
    blocks[role] = fences[index].content;
  });

  const temporaryRoot = await mkdtemp(join(tmpdir(), "amanos-quickstart-"));
  const workspace = join(temporaryRoot, "workspace");

  try {
    await mkdir(workspace, { recursive: true });

    // Step: amanos init "$WORKSPACE"
    const initCommand = blocks["init-command"].trim();
    if (!/^amanos init "\$WORKSPACE"$/u.test(initCommand)) {
      throw new Error(`Unexpected init command in doc: ${JSON.stringify(initCommand)}`);
    }
    const initResult = runCli(["init", workspace], temporaryRoot);
    if (initResult.status !== 0) {
      violations.push(`amanos init exited with status ${initResult.status}, expected 0.\n${initResult.stdout}`);
    }
    assertLinesInclude(
      initResult.stdout,
      blocks["init-output"],
      [["<WORKSPACE>", `${escapeRegex(workspace)}.*`]],
      "amanos init stdout",
      violations,
    );

    const decisionsPath = join(workspace, "DECISIONS.md");
    const decisionsAfterInit = await readFile(decisionsPath, "utf8");
    assertLinesInclude(decisionsAfterInit, blocks["decisions-after-init"], [], "DECISIONS.md after init", violations);

    // Step: sample note
    const noteContent = blocks["sample-note"];
    const notesDirectory = join(workspace, "notes");
    await mkdir(notesDirectory, { recursive: true });
    await writeFile(join(notesDirectory, "api.md"), noteContent, "utf8");

    // Step: amanos scan "$WORKSPACE"
    const scanCommand = blocks["scan-command"].trim();
    if (!/^amanos scan "\$WORKSPACE"$/u.test(scanCommand)) {
      throw new Error(`Unexpected scan command in doc: ${JSON.stringify(scanCommand)}`);
    }
    const scanResult = runCli(["scan", workspace], temporaryRoot);
    if (scanResult.status !== 0) {
      violations.push(`amanos scan exited with status ${scanResult.status}, expected 0.\n${scanResult.stdout}`);
    }
    assertLinesInclude(
      scanResult.stdout,
      blocks["scan-output"],
      [["<MS>", "\\d+"]],
      "amanos scan stdout",
      violations,
    );

    const decisionsAfterScan = await readFile(decisionsPath, "utf8");
    const today = new Date().toISOString().slice(0, 10);
    assertLinesInclude(
      decisionsAfterScan,
      blocks["decisions-after-scan"],
      [["<DATE>", escapeRegex(today)]],
      "DECISIONS.md after scan",
      violations,
    );

    // Step: amanos status "$WORKSPACE"
    const statusCommand = blocks["status-command"].trim();
    if (!/^amanos status "\$WORKSPACE"$/u.test(statusCommand)) {
      throw new Error(`Unexpected status command in doc: ${JSON.stringify(statusCommand)}`);
    }
    const statusResult = runCli(["status", workspace], temporaryRoot);
    if (statusResult.status !== 0) {
      violations.push(`amanos status exited with status ${statusResult.status}, expected 0.\n${statusResult.stdout}`);
    }
    assertLinesInclude(statusResult.stdout, blocks["status-output"], [], "amanos status stdout", violations);

    // Step: documented cleanup actually resets the workspace.
    const cleanupCommand = blocks["cleanup-command"].trim();
    if (!cleanupCommand.startsWith("rm -rf")) {
      throw new Error(`Unexpected cleanup command in doc: ${JSON.stringify(cleanupCommand)}`);
    }
    await rm(join(workspace, ".amanos"), { recursive: true, force: true });
    await rm(decisionsPath, { force: true });
    await rm(notesDirectory, { recursive: true, force: true });

    const resetInit = runCli(["init", workspace], temporaryRoot);
    if (resetInit.status !== 0) {
      violations.push(`amanos init after documented cleanup exited with status ${resetInit.status}, expected 0.`);
    }
    const decisionsAfterReset = await readFile(decisionsPath, "utf8");
    assertLinesInclude(
      decisionsAfterReset,
      blocks["decisions-after-init"],
      [],
      "DECISIONS.md after documented cleanup and re-init",
      violations,
    );

    // Also cover the documented error cases so the troubleshooting table stays accurate.
    const uninitializedWorkspace = join(temporaryRoot, "uninitialized");
    await mkdir(uninitializedWorkspace, { recursive: true });
    const uninitScan = runCli(["scan", uninitializedWorkspace], temporaryRoot);
    if (uninitScan.status !== 1) {
      violations.push(`amanos scan on an uninitialized workspace exited with ${uninitScan.status}, expected 1.`);
    }

    const missingArg = runCli(["scan"], temporaryRoot);
    if (missingArg.status !== 2) {
      violations.push(`amanos scan without a workspace argument exited with ${missingArg.status}, expected 2.`);
    }

    const missingWorkspace = runCli(["scan", join(temporaryRoot, "does-not-exist")], temporaryRoot);
    if (missingWorkspace.status !== 1) {
      violations.push(`amanos scan on a nonexistent workspace exited with ${missingWorkspace.status}, expected 1.`);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  if (violations.length > 0) {
    console.error(["Quickstart doc check failed:", ...violations.map((item) => `- ${item}`)].join("\n\n"));
    process.exitCode = 1;
    return;
  }

  console.log("Quickstart doc check passed: docs/quickstart.md matches the real CLI behaviour.");
}

await main();
