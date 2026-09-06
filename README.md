# amanos

**Entscheidungen, die nicht versanden.**

Amanos ist ein lokales Entscheidungs-Gedächtnis für Projekte und Code. Die CLI erkennt Entscheidungen in freien Notizen, hält sie in einer zentralen `DECISIONS.md` fest und findet mögliche Auswirkungen über mehrere Git-Repositories hinweg.

V1 ist als lokal installierbare CLI lauffähig. Das npm-Paket ist noch privat und nicht in der npm-Registry veröffentlicht.

## Voraussetzungen und Installation

- Node.js 20 oder neuer
- npm

Im geklonten Repository:

```bash
npm install
npm run build
npm link
amanos --version
```

`npm link` stellt den Befehl `amanos` systemweit als Verknüpfung auf diesen lokalen Checkout bereit.

## Die vier Befehle

| Befehl | Verhalten |
| --- | --- |
| `amanos init <workspace>` | Erstellt `DECISIONS.md`, `.amanos/config.json` und `.amanos/state.json`, ohne vorhandene Dateien zu überschreiben. |
| `amanos scan <workspace>` | Liest unterstützte Textquellen, ergänzt neue Entscheidungen und aktualisiert mögliche Auswirkungen. |
| `amanos watch <workspace>` | Beobachtet den Workspace rekursiv und führt nach einer Ruhezeit denselben schreibenden Scan aus. |
| `amanos status <workspace>` | Zeigt Entscheidungen, Impact-Kandidaten, blockierte Änderungen und den letzten Scan kompakt an. |

`scan` unterstützt zusätzlich `--dry-run` und `--verbose`; `status` unterstützt `--verbose`. Die vollständige Hilfe zeigt `amanos --help`.

## Beispiel-Workflow

Das Beispiel greift die Entscheidung der Landingpage auf. Der vorhandene Workspace `~/workspace` enthält ein Git-Repository `app` mit `src/api/rate-limit.ts`. In `notes/api.md` steht in Zeile 8:

```md
Decision: API rate limit: 100 req/min.
```

Workspace einmalig initialisieren und scannen:

```bash
amanos init ~/workspace
amanos scan ~/workspace
```

Eine echte Ausführung in einem frischen Beispiel-Workspace ergab:

```text
Read 1 source file.
Found 1 new decision.
Found 1 new candidate impact.
Completed in 213 ms.
```

Danach enthält `DECISIONS.md`:

```md
# Decisions

This file is maintained by amanos and is append-only: entries are added, never
rewritten or removed. Edit it by hand only if you are willing to keep that rule.

## D-001 — Decision: API rate limit: 100 req/min.

Status: active
Confidence: 87 %
Erkannt: 2026-09-06
Quelle: notes/api.md#L8

### Auswirkungen

- [ ] candidate · app/src/api/rate-limit.ts
```

Der Status dazu:

```bash
amanos status ~/workspace
```

```text
1 active decision
1 candidate impact
0 blocked changes
Last scan: just now
```

Für den laufenden Betrieb startet man stattdessen den Watcher:

```bash
amanos watch ~/workspace
```

Er bleibt bis `Ctrl+C` im Vordergrund. Nach einer relevanten Dateiänderung wartet er standardmäßig 60 Sekunden ohne weitere Änderung und führt dann `scan` aus. Dabei werden `DECISIONS.md` und `.amanos/state.json` tatsächlich aktualisiert; nur `amanos scan --dry-run` garantiert einen Lauf ohne Schreibzugriffe.

## Erkannte Quellen und Auswirkungen

Amanos liest `.md`, `.markdown`, `.html`, `.htm` und `.txt`. Die Erkennung verwendet in V1 einen deterministischen deutschen und englischen Phrasenparser. Jede Entscheidung erhält eine Quelle mit Zeilennummer, einen Confidence-Wert und abhängig vom Schwellwert den Status `active` oder `draft`.

Für jede Entscheidung sucht Amanos in lokalen Git-Repositories nach thematisch passenden Dateien. Diese Treffer sind ausschließlich `candidate`-Hinweise zur Prüfung, keine bestätigten oder bereits umgesetzten Änderungen.

## Grenzen von V1

- vollständig local-first: kein eigener Cloud-Service, kein Account und keine Übertragung des Workspace
- keine Änderungen am Code gefundener Repositories
- keine Ausführung eines Coding-Agenten und keine automatische Erstellung von Branches, Commits oder Tests
- niemals automatischer Push und niemals automatischer Merge
- kein Dashboard und kein Backend
- Installation derzeit nur aus dem Quell-Repository, nicht aus der npm-Registry

`amanos-agent-anleitung.md` ist ein [internes Arbeitsdokument](./amanos-agent-anleitung.md). Es beschreibt auch frühere Zielbilder und ist weder Benutzerhandbuch noch verbindliche Beschreibung des aktuellen V1-Verhaltens.

## Website bauen

Die Landingpage liegt in `site/` und wird mit Astro gebaut:

```bash
npm --prefix site install
npm --prefix site run build
```

Der statische Produktions-Build landet in `site/dist/`. Die Root-Konfiguration in `vercel.json` beschränkt Installation, Build und Ausgabe auf die Website; das CLI-Paket bleibt außerhalb des Website-Deployments.

## Lizenz

Apache-2.0, siehe [LICENSE](./LICENSE).
