# Quickstart: vom Checkout zum ersten `DECISIONS.md`-Eintrag

Diese Anleitung führt einmal komplett vor, wie ein frischer Checkout zur ersten
erkannten Entscheidung in `DECISIONS.md` wird. Jeder gezeigte Befehl und jede
gezeigte Ausgabe wird von [`scripts/check-quickstart.mjs`](../scripts/check-quickstart.mjs)
automatisiert in einem frischen temporären Verzeichnis nachvollzogen; die CI
führt dieses Skript bei jedem Push und jeder Pull Request aus (siehe
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). Weicht die
tatsächliche CLI-Ausgabe von dieser Seite ab, schlägt die CI fehl.

## Voraussetzungen

- **Node.js:** `>=20` (siehe `engines` in [`package.json`](../package.json)).
  Die CI baut und testet zusätzlich konkret gegen Node.js `24.20.0`.
- **Betriebssystem:** Linux und Windows sind die unterstützten Plattformen;
  die CI-Matrix in `.github/workflows/ci.yml` führt jeden Lauf auf
  `ubuntu-latest` und `windows-latest` aus. macOS wird nicht separat getestet,
  funktioniert aber erfahrungsgemäß ebenso, da Amanos keine plattformspezifischen
  Abhängigkeiten hat.
- **npm** (mit Node.js ausgeliefert) zum Bauen und Verlinken der CLI.
- Ein lokaler Checkout von `amanos`; das veröffentlichte `amanos@0.0.1` auf npm
  ist ein fehlerhafter Stub (siehe [README](../README.md)).

## 1. Installation

Im geklonten Repository (Details und der reproduzierbare Release-Smoke-Test
stehen im README unter [„Voraussetzungen und Installation"](../README.md#voraussetzungen-und-installation)):

```bash
npm install
npm run build
npm link
amanos --version
```

`npm link` macht den Befehl `amanos` systemweit verfügbar. Alternativ kann in
jedem der folgenden Schritte `node dist/cli.js` anstelle von `amanos`
verwendet werden, ohne `npm link` auszuführen — genau das tut auch
`scripts/check-quickstart.mjs`, um in CI ohne globale Installation
auszukommen.

## 2. Workspace anlegen: `amanos init`

Amanos arbeitet auf einem beliebigen Verzeichnis, das als „Workspace"
dient. Für dieses Beispiel wählen wir ein leeres Verzeichnis:

```bash
amanos init "$WORKSPACE"
```

Eine echte Ausführung in einem frischen, leeren Verzeichnis ergibt:

```text
  created DECISIONS.md
  created .amanos/config.json
  created .amanos/state.json
Initialised the amanos workspace in <WORKSPACE>.
```

`<WORKSPACE>` steht hier für den absoluten Pfad des Workspace-Verzeichnisses.
`init` überschreibt nie vorhandene Dateien; ein zweiter Aufruf meldet
stattdessen `exists` für jede bereits vorhandene Datei und ändert nichts.

Direkt nach `init` enthält `DECISIONS.md` nur den festen Kopf:

```md
# Decisions

This file is maintained by amanos and is append-only: entries are added, never
rewritten or removed. Edit it by hand only if you are willing to keep that rule.
```

## 3. Eine Beispielnotiz mit einer Entscheidung anlegen

Amanos erkennt Entscheidungsphrasen in `.md`, `.markdown`, `.html`, `.htm` und
`.txt`-Dateien. Wir legen `notes/api.md` mit einer Entscheidung an:

```md
# API notes

Decision: use rate limiting of 100 req/min for the public API.
```

## 4. Scannen: `amanos scan`

```bash
amanos scan "$WORKSPACE"
```

Eine echte Ausführung gegen den Workspace aus den Schritten 2 und 3 ergibt:

```text
Read 1 source file.
Found 1 new decision.
No new candidate impacts.
Completed in <MS> ms.
```

(`<MS>` steht für die tatsächliche Laufzeit in Millisekunden, die von Lauf zu
Lauf variiert.) `scan` erzeugt keine Kandidaten-Auswirkungen, weil in diesem
minimalen Beispiel kein Sibling-Git-Repository neben dem Workspace liegt;
siehe [README, „Erkannte Quellen und Auswirkungen"](../README.md#erkannte-quellen-und-auswirkungen)
für das vollständige Beispiel mit einem betroffenen Repository.

## 5. Ergebnis: der erste `DECISIONS.md`-Eintrag

Nach dem Scan enthält `DECISIONS.md`:

```md
# Decisions

This file is maintained by amanos and is append-only: entries are added, never
rewritten or removed. Edit it by hand only if you are willing to keep that rule.

## D-001 — Decision: use rate limiting of 100 req/min for the public API.

Status: active
Confidence: 96 %
Erkannt: <DATE>
Quelle: notes/api.md#L3

### Auswirkungen

- [ ] Noch nicht analysiert
```

`<DATE>` ist das tatsächliche Scan-Datum im Format `JJJJ-MM-TT`.

## 6. Status abfragen (optional)

```bash
amanos status "$WORKSPACE"
```

```text
1 active decision
0 candidate impacts
0 blocked changes
Last scan: just now
```

Für laufenden Betrieb anstelle wiederholter manueller Scans siehe
`amanos watch <workspace>` im README-Abschnitt
[„Die vier Befehle"](../README.md#die-vier-befehle).

## Zurücksetzen (Cleanup)

Amanos legt ausschließlich `DECISIONS.md` und das Verzeichnis `.amanos/` im
Workspace an. Um den Zustand aus diesem Quickstart vollständig zu entfernen:

```bash
rm -rf "$WORKSPACE/.amanos" "$WORKSPACE/DECISIONS.md" "$WORKSPACE/notes"
```

Ein erneuter `amanos init "$WORKSPACE"` beginnt danach wieder bei einem leeren
`DECISIONS.md`.

## Troubleshooting

| Symptom | Ursache | Abhilfe |
| --- | --- | --- |
| `amanos: Missing <workspace> argument for "…".` (Exit-Code `2`) | Befehl ohne Workspace-Pfad aufgerufen | Workspace-Pfad als Argument angeben, z. B. `amanos scan ./workspace` |
| `amanos: Workspace "…" does not exist.` (Exit-Code `1`) | Angegebener Pfad existiert nicht | Pfad prüfen oder Verzeichnis zuerst anlegen |
| `amanos: …/.amanos/config.json is missing. Run "amanos init …" to set up the workspace.` (Exit-Code `1`) | `scan`, `status` oder `watch` auf einem nicht initialisierten Workspace aufgerufen | Zuerst `amanos init <workspace>` ausführen |
| `npm link` schlägt mit einem Berechtigungsfehler fehl | Globale npm-Verzeichnisse erfordern erhöhte Rechte (verbreitet unter Linux/macOS ohne Node-Versionsmanager) | Einen Node-Versionsmanager (z. B. nvm) verwenden oder statt `amanos` direkt `node dist/cli.js` aufrufen |
| `npm install` oder `npm run build` schlägt mit einem Engine- oder Syntaxfehler fehl | Node.js-Version älter als 20 | Node.js auf Version 20 oder neuer aktualisieren (siehe „Voraussetzungen" oben) |
| `amanos scan` läuft durch, aber es entstehen keine Kandidaten-Auswirkungen | Es liegt kein Git-Repository neben dem Workspace, dessen Dateien thematisch zur Entscheidung passen | Erwartet für dieses Minimalbeispiel; für das vollständige Beispiel mit Auswirkungen siehe README |

Für den vollständigen Release-Status und weitere Verifikationsschritte siehe
[`docs/v1-verification.md`](./v1-verification.md); für den Umgang mit
Rechtsfragen bzw. Datenschutz siehe [`docs/legal-review.md`](./legal-review.md)
und [`docs/privacy-review.md`](./privacy-review.md).
