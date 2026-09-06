# Demo workspace

A minimal, reproducible product demo for amanos: two mini git repositories and
one notes file with one German and one English decision phrase, plus the
exact `DECISIONS.md` and terminal output that `amanos init` + `amanos scan`
produce from them.

## Layout

- `repos/website/src/pricing.html` and `repos/app/src/billing.ts` — plain
  fixture files, **not** git repositories. The check script `git init`s a
  copy of each into a fresh temp workspace, so no `.git` directories are
  committed to this repository.
- `notes/decisions.md` — the source note. It contains one German decision
  ("Wir haben entschieden, dass ...") and one English decision ("We decided
  to ..."), both of which the parser recognises and both of which produce
  candidate impacts in *both* mini repositories.
- `expected/DECISIONS.md` and `expected/terminal-output.txt` — the golden
  files. Dynamic values (the temp workspace path, the scan duration, and
  today's date) are replaced with `<WORKSPACE_ROOT>`, `<DURATION_MS>` and
  `<DATE>` placeholders so the fixtures stay stable across machines and days.

## Running it yourself

```bash
npm run build
npm run check:example
```

This sets up a temporary workspace from the fixtures above, runs the real
`amanos init` and `amanos scan` commands against it, and compares the
(normalised) output to the files in `expected/`. It exits non-zero if the
output has drifted — this is exactly what CI runs on every push.

If you want to see the demo run without the comparison, copy `repos/website`
and `repos/app` into a scratch directory, `git init` each one, add
`notes/decisions.md`, and run `amanos init <dir>` followed by
`amanos scan <dir>` from a build of this repository.

## Regenerating the golden files

If a deliberate behaviour change alters the output, run `npm run
check:example`, note the diff it prints, and update `expected/DECISIONS.md`
and `expected/terminal-output.txt` accordingly (keeping the `<WORKSPACE_ROOT>`,
`<DURATION_MS>` and `<DATE>` placeholders in place of the values that vary
between runs).
