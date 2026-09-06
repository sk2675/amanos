# CLI- und Konfigurationsreferenz

Diese Seite ist die vollständige Referenz für alle vier amanos-Befehle, die
beiden JSON-Dateien unter `.amanos/` und das Format von `DECISIONS.md`. Sie
ergänzt [`docs/quickstart.md`](./quickstart.md), das nur den schmalen
Glücksfall vom frischen Checkout bis zum ersten Eintrag zeigt: Hier stehen
zusätzlich alle Optionen, alle Exit-Codes, das komplette Konfigurationsschema
und die Regeln, nach denen amanos Quellen liest, Repositories abgrenzt und
Git-Daten ausschließlich lesend verwendet.

Jede hier behauptete Verhaltensweise ist gegen den Quellcode geprüft, nicht
geraten: Exit-Codes gegen `src/errors.ts` und `src/cli.ts`, Optionen gegen
`src/cli/args.ts`, Konfigurationsfelder gegen `src/workspace/config.ts`,
Zustandsfelder gegen `src/workspace/state.ts`, Ignorierregeln gegen
`src/scan/sources.ts`, `src/impact/index.ts` und `src/repos/index.ts`.

## Aufruf

```text
amanos <command> <workspace> [optionen]
amanos --help | -h
amanos --version | -v
```

`<workspace>` ist ein beliebiges, bereits existierendes Verzeichnis. Es muss
kein Git-Repository sein — amanos legt seine eigenen Dateien direkt darin an
und sucht *innerhalb* dieses Verzeichnisses nach Git-Repositories, die es nur
liest (siehe [„Workspace-Grenzen"](#workspace-grenzen)).

`--help`/`-h` und `--version`/`-v` sind an jeder Position gültig und
überschreiben jede andere Auswertung; wird eine dieser Optionen erkannt, führt
amanos keinen Befehl aus.

## Exit-Codes

Definiert in [`src/errors.ts`](../src/errors.ts) und ausgewertet in
[`src/cli.ts`](../src/cli.ts):

| Code | Bedeutung | Auslöser |
| --- | --- | --- |
| `0` | Erfolg | Befehl wurde vollständig ausgeführt, inklusive `--help` und `--version`. |
| `1` | Laufzeit- oder Workspace-Fehler | Jeder `AmanosError` ohne eigenen Exit-Code (z. B. fehlender Workspace, defekte `.amanos/config.json`, nicht lesbares Repository) sowie jeder nicht erwartete, nicht klassifizierte Fehler. |
| `2` | Aufruf-/Nutzungsfehler | Jeder `UsageError`: unbekannter Befehl, unbekannte Option, fehlendes oder überzähliges `<workspace>`-Argument, eine Option am falschen Befehl (z. B. `--dry-run` bei `watch`). |

Bei Exit-Code `1` oder `2` gibt amanos die Meldung auf `stderr` mit dem Präfix
`amanos:` aus; bei `2` folgt zusätzlich der Hinweis
`Run "amanos --help" to see the available commands.`. `NotImplementedError`
ist ein `AmanosError` ohne eigenen Code und fällt damit ebenfalls unter `1`;
V1 wirft ihn an keiner erreichbaren Stelle.

## `amanos init <workspace>`

```text
amanos init <workspace>
```

Legt die drei von amanos verwalteten Artefakte an, sofern sie noch nicht
existieren: `DECISIONS.md` mit dem festen Kopf, `.amanos/config.json` mit den
Standardwerten und `.amanos/state.json` mit dem Ausgangszustand. Für jede
Datei wird `created` oder `exists` ausgegeben; vorhandene Dateien bleiben
byteidentisch, ein zweiter `init`-Lauf ist also gefahrlos und idempotent.

**Optionen:** keine.

**Exit-Codes:** `0` bei Erfolg. `1`, wenn `<workspace>` nicht existiert, kein
Verzeichnis ist, nicht lesbar ist, oder `.amanos/` darin nicht angelegt werden
kann (z. B. Berechtigungsfehler) — all das sind `AmanosError`-Fälle aus
[`src/workspace/paths.ts`](../src/workspace/paths.ts) bzw.
[`src/store/init.ts`](../src/store/init.ts). `2`, wenn das
`<workspace>`-Argument selbst fehlt oder zu viele Argumente angegeben wurden,
oder ein unbekannter Befehl bzw. eine unbekannte Option verwendet wurde
(`UsageError` aus `src/cli/args.ts`).

**Beispielausgabe:**

```text
  created DECISIONS.md
  created .amanos/config.json
  created .amanos/state.json
Initialised the amanos workspace in <WORKSPACE>.
```

## `amanos scan <workspace> [--dry-run] [--verbose]`

```text
amanos scan <workspace> [--dry-run] [--verbose]
```

Liest alle unterstützten Textquellen im Workspace (siehe
[„Erkannte Quellen"](#erkannte-quellen-scan)), erkennt darin neue
Entscheidungen, hängt sie an `DECISIONS.md` an und ermittelt anschließend für
jede — auch für bereits vorhandene — Entscheidung mögliche Auswirkungen in
allen gefundenen Git-Repositories (siehe [„Impact-Matching"](#impact-matching)).
`.amanos/state.json` wird danach mit dem Scan-Zeitpunkt, den gesehenen
Repositories und aufgetretenen Fehlern aktualisiert.

**Optionen:**

- `--dry-run` — berechnet dasselbe Ergebnis, schreibt aber weder
  `DECISIONS.md` noch `.amanos/state.json`. Stattdessen werden die geplanten
  Ergänzungen als `would add …`-Zeilen ausgegeben. Nur mit `scan` kombinierbar.
- `--verbose` — gibt zusätzlich zur kompakten Fehlerzahl jede einzelne
  aufgetretene Fehlermeldung mit Pfad aus. Ohne `--verbose` erscheint nur
  `N errors — use --verbose for details`.

**Exit-Codes:** `0`, auch wenn beim Lesen einzelner Quellen oder Repositories
Fehler auftraten — solche Fehler werden gesammelt, gemeldet und in
`.amanos/state.json` protokolliert, brechen den Scan aber nicht ab. `1` nur
bei einem strukturellen Fehler (z. B. der Workspace selbst oder
`.amanos/config.json` sind nicht lesbar). `2` bei falschem Aufruf, etwa
`--dry-run` zusammen mit `watch` oder `status`.

**Beispielausgabe** (ein neuer Fund, eine neue Kandidaten-Auswirkung):

```text
Read 1 source file.
Found 1 new decision.
Found 1 new candidate impact.
Completed in 213 ms.
```

## `amanos watch <workspace>`

```text
amanos watch <workspace>
```

Beobachtet den Workspace rekursiv auf Dateiänderungen und führt nach einer
Ruhezeit ohne weitere Änderung denselben schreibenden Scan wie `amanos scan`
aus (ohne `--dry-run` — der Watcher schreibt also tatsächlich in
`DECISIONS.md` und `.amanos/state.json`). Die Ruhezeit ist
`quietPeriodSeconds` aus `.amanos/config.json` (Standard: 60 Sekunden).
Relevante Änderungen sind nur solche an unterstützten Quelldateien außerhalb
ignorierter Verzeichnisse; Änderungen an `DECISIONS.md` selbst lösen nie einen
Scan aus.

`watch` hält pro Workspace eine Sperrdatei
(`.amanos/watch.lock`); ein zweiter `watch`-Aufruf auf demselben Workspace
scheitert, solange der erste Prozess läuft. Eine verwaiste Sperrdatei eines
nicht mehr laufenden Prozesses wird automatisch entfernt. Der Befehl läuft im
Vordergrund, bis er mit `Ctrl+C` beendet wird; danach wird die Sperre
freigegeben und der Prozess beendet sich sauber.

**Optionen:** keine. Weder `--dry-run` noch `--verbose` sind für `watch`
gültig; beide führen zu Exit-Code `2`.

**Exit-Codes:** `0` bei sauberer Beendigung über `Ctrl+C`. `1`, wenn der
Dateisystem-Watcher selbst fehlschlägt (z. B. Workspace während der
Beobachtung entfernt) oder ein anderer Prozess den Workspace bereits
beobachtet. `2` bei falschem Aufruf.

**Beispielausgabe:**

```text
Watching <WORKSPACE>. Quiet period: 60 s.
Change detected: notes/api.md. Waiting 60 s.
Scan started.
Scan finished: 1 new decision, 1 new candidate impact, 0 errors.
```

## `amanos status <workspace> [--verbose]`

```text
amanos status <workspace> [--verbose]
```

Zeigt eine kompakte, rein lesende Übersicht: Anzahl der Entscheidungen mit
Status `active`, `draft` (nur wenn größer 0) und `blocked`, Anzahl eindeutiger
Kandidaten-Auswirkungen, den Zeitpunkt des letzten Scans relativ
(„just now“, „N minutes ago“, „N hours ago“, „N days ago“ oder „never“) und
die Anzahl protokollierter Fehler aus `.amanos/state.json`. `status`
verändert keine Datei.

**Optionen:**

- `--verbose` — gibt zusätzlich zur Fehlerzahl jeden protokollierten Fehler
  mit Pfad und Zeitstempel aus.

**Exit-Codes:** `0` bei Erfolg. `1`, wenn `DECISIONS.md` oder
`.amanos/state.json` fehlen oder nicht lesbar sind (Hinweis: dann zuerst
`amanos init <workspace>` ausführen) oder eine der beiden Dateien
strukturell ungültig ist. `2` bei falschem Aufruf, etwa `--dry-run` bei
`status`.

**Beispielausgabe:**

```text
1 active decision
1 candidate impact
0 blocked changes
Last scan: just now
```

## `.amanos/config.json`

Wird von `amanos init` mit den Standardwerten angelegt und bei jedem
`amanos scan`/`amanos watch`-Lauf gelesen. Fehlende Felder werden durch die
Standardwerte ersetzt, unbekannte Felder bleiben unverändert erhalten (auch
über einen Schreibzugriff hinweg), falsche Werte führen zu einem `AmanosError`
mit genauer Feldangabe (Exit-Code `1`). Quelle:
[`src/workspace/config.ts`](../src/workspace/config.ts).

| Feld | Typ | Standard | Gültige Werte |
| --- | --- | --- | --- |
| `quietPeriodSeconds` | ganze Zahl | `60` | `1`–`86400` (24 Stunden). Sekunden ohne weitere Dateiänderung, bevor `amanos watch` einen Scan startet. |
| `activation.defaultStatus` | Zeichenkette | `"active"` | einer von `active`, `draft`, `blocked`, `done` (siehe [Status-Modell](#status-modell)). Status, den eine neu erkannte Entscheidung erhält, wenn ihre Confidence *nicht* unter `draftBelowConfidence` liegt. |
| `activation.draftBelowConfidence` | ganze Zahl | `70` | `0`–`100`. Liegt die berechnete Confidence einer Entscheidung darunter, wird sie unabhängig von `defaultStatus` immer als `draft` gespeichert, nie automatisch aktiviert. |
| `extraPhrases` | Array aus nicht-leeren Zeichenketten | `[]` | Zusätzliche Entscheidungsphrasen, die zusätzlich zur eingebauten deutsch/englischen Liste erkannt werden. Ein Duplikat einer eingebauten Phrase wird ignoriert, statt deren Stärke abzuschwächen. Nutzerdefinierte Phrasen erhalten immer die Stärke `medium`, unabhängig davon, was der Nutzer beabsichtigt. |
| `agent` | Zeichenkette | `"codex"` | Name eines Coding-Agent-Adapters. In V1 wird jeder konfigurierte Name auf einen No-Op-Adapter aufgelöst (`src/agent/index.ts`); der Wert wird gelesen, aber es wird kein Prozess gestartet und kein Repository verändert. Erst ab einer späteren Phase wirksam. |

Beispiel (Standardwerte, wie `amanos init` sie schreibt):

```json
{
  "quietPeriodSeconds": 60,
  "activation": {
    "defaultStatus": "active",
    "draftBelowConfidence": 70
  },
  "extraPhrases": [],
  "agent": "codex"
}
```

## `.amanos/state.json`

Wird von `amanos init` mit dem Ausgangszustand angelegt und ausschließlich von
`amanos scan` und `amanos watch` geschrieben (nie von `status`, nie im
`--dry-run`-Modus). Wie bei `config.json` überleben unbekannte Felder jeden
Schreibzugriff. Quelle: [`src/workspace/state.ts`](../src/workspace/state.ts).

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `lastScanAt` | ISO-8601-Zeitstempel oder `null` | Zeitpunkt des letzten abgeschlossenen (nicht Dry-Run-)Scans. `null` vor dem ersten Scan. |
| `nextDecisionNumber` | ganze Zahl ≥ 1 | Fortlaufender Zähler für die nächste Entscheidungs-ID (`D-004` usw.). Ein dauerhafter Höchststand: Wird `D-003` von Hand aus `DECISIONS.md` gelöscht, vergibt amanos diese Nummer trotzdem nie erneut. |
| `repositories` | Array von `{ path, lastSeenAt, … }` | Jedes bei einem Scan gefundene Git-Repository, mit Pfad relativ zum Workspace (`/` als Trenner, `.` für den Workspace selbst als Repository) und dem Zeitpunkt, zu dem es zuletzt gesehen wurde. |
| `errors` | Array von `{ message, at, path, … }` | Jeder beim letzten Scan aufgetretene, nicht abbrechende Fehler (unlesbare Datei, unlesbares Verzeichnis, `git ls-files` fehlgeschlagen), mit Zeitpunkt und betroffenem Pfad. Wird bei jedem Scan komplett neu geschrieben, nicht angehängt. |

Beispiel (Ausgangszustand, wie `amanos init` ihn schreibt):

```json
{
  "lastScanAt": null,
  "nextDecisionNumber": 1,
  "repositories": [],
  "errors": []
}
```

## `DECISIONS.md`

Die für Menschen lesbare, append-only geführte Quelle der Wahrheit. Der Kopf
wird einmalig von `amanos init` geschrieben:

```md
# Decisions

This file is maintained by amanos and is append-only: entries are added, never
rewritten or removed. Edit it by hand only if you are willing to keep that rule.
```

Jede erkannte Entscheidung wird als eigener Abschnitt angehängt. Format
(Quelle: [`src/store/decisions.ts`](../src/store/decisions.ts), reales
Beispiel aus [`examples/demo/expected/DECISIONS.md`](../examples/demo/expected/DECISIONS.md)):

```md
## D-001 — Wir haben entschieden, dass der Pro-Tarif 29 EUR pro Monat kostet.

Status: active
Confidence: 96 %
Erkannt: 2026-09-06
Quelle: notes/decisions.md#L3

### Auswirkungen

- [ ] candidate · app/src/billing.ts
- [ ] candidate · website/src/pricing.html

Möglicherweise abgelöst durch: D-002
```

Feldbedeutung:

- **Überschrift** — `## D-001 — <Statement>`. Die ID ist dreistellig
  aufsteigend nummeriert (`D-001`, `D-002`, …), das Statement ist der erkannte
  Satz, auf maximal 200 Zeichen gekürzt.
- **`Status`** — einer der vier Werte aus dem [Status-Modell](#status-modell).
  Nur diese eine Zeile wird von amanos je nachträglich verändert (siehe dort).
- **`Confidence`** — ganzzahliger Prozentwert 0–100, siehe
  [`src/parser/confidence.ts`](../src/parser/confidence.ts): eine feste Summe
  aus Phrasenstärke (26/38/50 Punkte), Nähe zu einer Überschrift (0/9/18
  Punkte), enthaltener Zahl (12 Punkte), Eigenname/Akronym (10 Punkte) und
  Satzlänge ab 6 Wörtern (6 Punkte).
- **`Erkannt`** — Datum (`JJJJ-MM-TT`, keine Uhrzeit) des Scans, der die
  Entscheidung gefunden hat.
- **`Quelle`** — Pfad relativ zum Workspace plus Zeilenangabe, z. B.
  `notes/api.md#L8` oder `notes/api.md#L8-L12` für einen mehrzeiligen Fund.
  Diese Datei/Zeile wird selbst nie als eigene Auswirkung vorgeschlagen.
- **`### Auswirkungen`** — Liste von Checkbox-Zeilen
  `- [ ] candidate · <pfad>`, maximal 10 pro Entscheidung, absteigend nach
  Anzahl passender Schlüsselwörter und Trefferzahl sortiert. Ein manuell
  gesetztes Häkchen (`- [x]`) bleibt über jeden weiteren Scan hinweg erhalten,
  auch wenn der Kandidat aus der aktuellen Rangliste fällt. Ohne jeden
  Kandidaten steht stattdessen `- [ ] Noch nicht analysiert`.
- **`Möglicher Ersatz für: D-00X`** / **`Möglicherweise abgelöst durch: D-00Y`**
  — optionale, automatisch gesetzte Querverweise, wenn eine neue Entscheidung
  thematisch eine ältere ersetzt (Ähnlichkeit über Titel und Quelle). Beide
  Richtungen werden gesetzt: die neue Entscheidung bekommt „Möglicher Ersatz
  für“, die ältere zusätzlich „Möglicherweise abgelöst durch“. Es handelt sich
  um einen Hinweis zur Prüfung, keine automatische Zusammenführung —
  bestehender Text und Status der älteren Entscheidung bleiben unverändert.
- **`Hinweis: Status am <Datum> von <alt> auf <neu> geändert.`** — wird
  eingefügt, wenn der Status einer Entscheidung programmatisch geändert wird
  (`updateDecisionStatus` in `src/store/decisions.ts`). Diese Funktion ist
  Teil der Bibliothek, aber **kein** V1-Befehl ruft sie auf; in V1 ändert sich
  der Status einer bestehenden Entscheidung also nur, wenn jemand die
  `Status:`-Zeile von Hand editiert.

Jeder Schreibzugriff auf `DECISIONS.md` erfolgt atomar (Schreiben in eine
temporäre Datei, dann Umbenennen) und verändert ausschließlich neue Bytes am
Ende oder innerhalb des betroffenen Abschnitts; handschriftlicher Text an
anderer Stelle bleibt exakt erhalten.

## Status-Modell

Die vier gültigen Werte sind `DECISION_STATUSES` in
[`src/workspace/config.ts`](../src/workspace/config.ts): `active`, `draft`,
`blocked`, `done`.

- **Bei der Erkennung** (`amanos scan`/`amanos watch`) entscheidet
  ausschließlich die Confidence über `active` vs. `draft`: Liegt die
  berechnete Confidence unter `activation.draftBelowConfidence` (Standard
  `70`), wird die Entscheidung als `draft` gespeichert — unabhängig vom
  konfigurierten `activation.defaultStatus`. Liegt sie darüber oder gleich,
  erhält sie den Wert von `activation.defaultStatus` (Standard `active`).
  Eine schwache Phrase allein (26 Punkte) kann diese Schwelle mit den
  Standardwerten nie überschreiten.
- **`blocked`** und **`done`** sind gültige, von `amanos status` gezählte
  Werte (`blocked` erscheint als „blocked changes“ in der Statuszeile), werden
  aber von keinem V1-Befehl automatisch gesetzt. Sie sind nur über
  handschriftliches Bearbeiten der `Status:`-Zeile in `DECISIONS.md`
  erreichbar, oder über die interne Bibliotheksfunktion
  `updateDecisionStatus`, die in V1 von keinem Befehl aufgerufen wird.
- **Nach der Erkennung** ändert amanos den Status einer bereits gespeicherten
  Entscheidung nie automatisch, auch nicht bei erneuten Scans. Ein erneuter
  Fund derselben Aussage aus derselber Quelle wird ohnehin als Duplikat
  übersprungen (`duplicateKey` in `src/parser/index.ts` — Quelle plus
  normalisiertes Statement).
- Ein handschriftlich eingetragener, nicht unterstützter Statuswert bleibt
  unverändert sichtbar und wird von `amanos status` nicht in eine der vier
  Kategorien gezwungen; er zählt einfach in keiner der Kategorien mit.

## Erkannte Quellen (`scan`)

Für die Entscheidungserkennung selbst liest `amanos scan`/`amanos watch` **nur**
Dateien mit den Endungen `.md`, `.markdown`, `.html`, `.htm` und `.txt`
(`SUPPORTED_EXTENSIONS` in [`src/parser/text.ts`](../src/parser/text.ts)),
rekursiv ab dem Workspace-Root. Dabei übersprungen werden:

- `DECISIONS.md` selbst — es wird nie als eigene Quelle geparst.
- Symbolische Links (Dateien und Verzeichnisse) — nie gefolgt, um Zyklen
  auszuschließen.
- Die Verzeichnisse `.git` sowie alle in `IGNORED_DIRECTORY_NAMES`
  aufgeführten Namen (siehe [„Workspace-Grenzen"](#workspace-grenzen)) —
  unabhängig davon, auf welcher Verzeichnisebene sie liegen.

Innerhalb einer gelesenen Datei wird bei Markdown der Inhalt von Codefences
(```` ``` ````/`~~~`) ignoriert — Beispielcode löst nie einen Fund aus — und
bei HTML werden Tags, `<script>`/`<style>`-Inhalte und Kommentare entfernt,
während die Zeilennummerierung des Originals für `Quelle: …#L…` erhalten
bleibt.

## Impact-Matching

Getrennt von der Quellenerkennung durchsucht `amanos scan`/`amanos watch` für
jede Entscheidung alle unter dem Workspace gefundenen Git-Repositories nach
thematisch passenden Dateien (Schlüsselwörter aus dem Entscheidungstitel).
Dabei gilt ein eigenes, breiteres Extensions-Set
(`TEXT_EXTENSIONS`/`TEXT_FILE_NAMES` in
[`src/impact/index.ts`](../src/impact/index.ts)) mit Programmiersprachen,
Konfigurationsformaten und Namen wie `Dockerfile`, `Makefile`, `.gitignore`
oder `.env*` — bewusst mehr als die reine Notiz-Erkennung, weil hier
*Code*-Dateien als Kandidaten in Frage kommen, nicht nur Notizen. Ausgeschlossen
sind Binärdateien (erkannt am Vorkommen eines Null-Bytes), Dateien über 1 MB
und die Quelldatei-Zeile der jeweiligen Entscheidung selbst. Welche Dateien
eines Repositories überhaupt betrachtet werden, bestimmt ausschließlich
`git ls-files --cached --others --exclude-standard` — also exakt die von Git
verfolgten sowie die von `.gitignore` nicht ausgeschlossenen Dateien dieses
Repositories.

## Workspace-Grenzen

**Der Workspace** ist genau das per `<workspace>`-Argument übergebene, zu
einem absoluten Pfad aufgelöste Verzeichnis
(`resolveWorkspace` in [`src/workspace/paths.ts`](../src/workspace/paths.ts)).
Er muss existieren und ein Verzeichnis sein, aber kein Git-Repository —
amanos legt `DECISIONS.md` und `.amanos/` direkt darin ab, unabhängig davon,
ob der Workspace selbst versioniert ist.

**Ein Repository** ist laut
[`src/repos/index.ts`](../src/repos/index.ts) jedes Verzeichnis unterhalb (und
einschließlich) des Workspace-Roots, das einen Eintrag namens `.git` enthält
— ein Verzeichnis für normale Klone, eine Datei für Worktrees und Submodule.
Die Suche ist rekursiv und findet auch verschachtelte Repositories; sie
steigt aber nie in `.git` selbst hinab (damit kann dessen Objekt-Datenbank nie
fälschlich als eigenes Repository erkannt werden) und überspringt dabei
dieselben ignorierten Verzeichnisnamen wie die Quellenerkennung:

```text
node_modules, dist, build, .amanos, .next, .cache, coverage, vendor
```

(`IGNORED_DIRECTORY_NAMES` in `src/repos/index.ts`; `amanos watch` ignoriert
beim Beobachten zusätzlich `.git`, `.astro`, `.mypy_cache`, `.nuxt`,
`.parcel-cache`, `.pytest_cache`, `.ruff_cache`, `.turbo`, `.vite` und
`__pycache__`, `out`, `target`.) Symlinks werden auch hier nie verfolgt.

Der Workspace selbst zählt als Repository, wenn er ein `.git`-Eintrag
enthält (Pfad `.` in `.amanos/state.json`); „sibling repository“ im Sinn der
übrigen Dokumentation meint ein Repository, das als eigenes Unterverzeichnis
*innerhalb* des Workspace liegt (z. B. `~/workspace/app`), nicht ein
Repository außerhalb des Workspace-Verzeichnisses — solche werden von amanos
nie gesehen, unabhängig von ihrer Nähe im Dateisystem.

## Git-Garantien

amanos **liest** Git-Repositories ausschließlich über
`git -C <repo> ls-files --cached --others --exclude-standard -z`, um die von
Git verfolgten und nicht ignorierten Dateien eines Repositories aufzulisten
(`gitFiles` in `src/impact/index.ts`). Das ist der einzige Git-Aufruf in ganz
amanos. Insbesondere gilt für jede erreichbare V1-Codepfad:

- amanos führt niemals `git add`, `git commit`, `git checkout`, `git stash`,
  `git push` oder irgendeinen anderen schreibenden Git-Befehl aus.
- amanos legt niemals eine Branch an, wechselt nie den aktuellen Branch und
  verändert nie den Arbeitsbaum oder die Staging-Area eines gefundenen
  Repositories.
- Der Coding-Agent-Seam (`agent`-Feld in `config.json`) ist in V1 fest auf
  einen No-Op-Adapter verdrahtet (`NoOpAgentAdapter` in
  `src/agent/index.ts`), der jede Anfrage sofort mit `kind: "aborted"`
  beantwortet, ohne einen Prozess zu starten oder ein Repository zu berühren.
  Das dokumentierte Sicherheits-Invariant für jeden künftigen Adapter — nur
  auf einer neuen lokalen Branch arbeiten, nie pushen oder mergen, nie die
  zuvor aktive Branch verändern — gilt bereits als Vertrag der Schnittstelle,
  ist in V1 aber mangels aktivem Adapter nicht beobachtbar.
- Einzige Ausnahme von „nur lesen“ sind die von amanos selbst verwalteten
  Dateien `DECISIONS.md`, `.amanos/config.json`, `.amanos/state.json` und
  `.amanos/watch.lock` **innerhalb des Workspace** — diese liegen außerhalb
  jedes gefundenen Git-Repositories im hier beschriebenen Sinn, es sei denn,
  der Workspace selbst ist ein Repository; auch dann ändert amanos an dessen
  Git-Zustand (Index, HEAD, Branches, Remotes) nichts.

`test/e2e.test.ts` prüft diese Garantie praktisch: Es führt `amanos scan`
gegen zwei echte, lokal angelegte Git-Repositories aus und behauptet
anschließend per `git status`, dass in beiden Repositories keinerlei
Änderung am Arbeitsbaum oder Index entstanden ist.

## Versionsstand

Diese Referenz beschreibt amanos `0.1.0` (V1-Release-Kandidat, Stand
September 2026). Sie ist kein automatisch generiertes
Artefakt; wer CLI-Verhalten, Konfigurationsfelder, Exit-Codes oder das
Format von `DECISIONS.md` ändert, muss diese Seite in derselben
Änderung nachziehen. Der Abgleich von V1-Umfang und Release-Status insgesamt
ist gesondert unter [`docs/v1-verification.md`](./v1-verification.md)
dokumentiert.
