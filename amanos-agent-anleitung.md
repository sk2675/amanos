# Amanos — Arbeitsanleitung für den Coding-Agenten

## Aufgabe

Baue `amanos`: ein lokales npm-CLI, das verstreute Projektentscheidungen aus freiem Text erkennt, ihre Auswirkungen über mehrere Git-Repositories nachverfolgt und die Umsetzung mit einem installierten Coding-Agenten vorbereitet.

`amanos` ist nach Amano-Garnelen benannt: ein kleiner Cleaner, der sich um liegengebliebene Kontextreste, offene Folgen und auseinanderlaufende Repositories kümmert.

## Produktversprechen

Eine Entscheidung soll nicht als vergessene Markdown-Notiz enden. Amanos hält sie als nachvollziehbaren Zustand fest und führt sie bis zu getesteten, lokalen Änderungen weiter.

## Nicht bauen

- Kein Web-Dashboard.
- Kein eigener Cloud-Service, Konto oder Backend.
- Keine automatische Veröffentlichung, kein Push und kein Merge.
- Keine stillen Änderungen im aktiven Branch eines Nutzers.
- Kein eigener LLM-Provider; Amanos verwendet einen lokal verfügbaren Coding-Agenten als Adapter.

## Zielumgebung

- Node.js/TypeScript npm-CLI.
- Windows zuerst, aber keine Windows-exklusive Architektur.
- Der Nutzer wählt einen Workspace-Ordner. Dieser enthält beliebig viele lokale Git-Repositories.
- Die zentrale, lesbare Wahrheit liegt in `<workspace>/DECISIONS.md`.
- Ein kleiner lokaler Index darf zusätzlich unter `<workspace>/.amanos/` liegen.

## V1: enger, wirklich lauffähiger Scope

### 1. CLI-Grundgerüst

Implementiere diese Befehle:

```text
amanos init <workspace>
amanos watch <workspace>
amanos status <workspace>
amanos scan <workspace>
```

`init` erzeugt nur:

```text
<workspace>/DECISIONS.md
<workspace>/.amanos/config.json
<workspace>/.amanos/state.json
```

Die Standard-Konfiguration soll bewusst klein sein:

```json
{
  "quietPeriodSeconds": 60,
  "activation": {
    "defaultStatus": "active",
    "draftBelowConfidence": 70
  },
  "agent": "codex"
}
```

### 2. Dateien beobachten

`watch` überwacht rekursiv den Workspace:

- Eingaben: `.md`, `.markdown`, `.html`, `.htm`, `.txt`.
- Ignoriere `.git`, `node_modules`, `dist`, `build`, `.amanos` und typische Cache-Ordner.
- Warte nach einer Änderung 60 Sekunden ohne weitere Änderung, bevor eine Analyse läuft.
- Verhindere parallele Läufe für denselben Workspace.
- Schreibe klare, kurze Terminalmeldungen.

### 3. Entscheidungen zunächst deterministisch erkennen

Noch keinen LLM-Zwang in den Kern einbauen. Implementiere zuerst eine nachvollziehbare Heuristik für deutsche und englische Entscheidungsphrasen, etwa:

```text
wir entscheiden
entschieden
beschlossen
ab jetzt
we will
we decided
decision:
```

Speichere für jeden Fund:

- kurze extrahierte Aussage;
- Quellpfad und Zeilenbereich;
- Zeitstempel;
- Confidence;
- Status (`active`, `draft`, `blocked`, `done`).

Die Agenten-Analyse wird als klare Adapter-Schnittstelle vorbereitet, aber erst nach diesem MVP aktiviert.

### 4. `DECISIONS.md` automatisch pflegen

Ergänze Einträge append-only. Vorhandene Einträge nie still überschreiben oder löschen.

Beispiel:

```md
## D-001 — Pro-Plan kostet 29 €

Status: active
Confidence: 87 %
Erkannt: 2026-09-05
Quelle: notes/pricing.md#L42-L58

### Auswirkungen

- [ ] Noch nicht analysiert
```

Wenn sich eine Entscheidung offensichtlich auf eine vorherige bezieht, verlinke sie als mögliche Ablösung; nicht automatisch als Ersetzung behandeln.

### 5. Repositories finden und Auswirkungen suchen

`scan` findet alle Git-Repositories innerhalb des Workspace (auch verschachtelte Repos, aber nicht innerhalb von `.git`).

Für V1 braucht die Auswirkungsanalyse keine AI:

- Leite prägnante Schlüsselwörter aus der Entscheidung ab (z. B. `pricing`, `pro`, `29`, `Stripe`).
- Durchsuche pro Repo Text-, Konfigurations- und Quellcodedateien nach diesen Wörtern.
- Schreibe Treffer unter die Entscheidung in `DECISIONS.md`.
- Markiere die Treffer ausdrücklich als `candidate`, nie als gesicherte Änderung.

Beispiel:

```md
### Auswirkungen

- [ ] candidate · website-repo/src/pricing.tsx
- [ ] candidate · app-repo/config/plans.ts
- [ ] candidate · billing-repo/stripe.md
```

### 6. Status und Sicherheit

`amanos status <workspace>` gibt eine kompakte Übersicht aus:

```text
3 active decisions
7 candidate impacts
1 blocked change
Last scan: 2 minutes ago
```

Wenn Dateien unlesbar sind, ein Git-Repo beschädigt ist oder ein Scan fehlschlägt: niemals die Entscheidung verlieren. Fehler im Index und in der Ausgabe sichtbar machen.

## Phase 2: Agent-Adapter

Erst umsetzen, wenn V1 funktioniert und getestet ist.

- Adapter für Codex CLI einführen.
- Der Adapter bekommt Entscheidung, Quellen, Kandidaten und Repo-Pfad.
- Er erzeugt einen konkreten Plan und einen Patch auf einem neuen lokalen Branch `amanos/D-001-<slug>`.
- Vor dem Commit Tests und Formatter aus dem jeweiligen Repo ausführen.
- Bei Erfolg: lokaler Commit, Ergebnis in `DECISIONS.md` vermerken.
- Bei Fehler: Branch behalten, Status `blocked`, relevante Fehlermeldung plus nächster Schritt notieren.
- Niemals pushen oder mergen.

## Technische Qualitätsanforderungen

- TypeScript, ESM, striktes Type-Checking.
- Kleine Module mit klaren Grenzen: CLI, Watcher, Parser, Decision Store, Repo Discovery, Impact Scan, Agent Adapter.
- Keine globale mutable State-Logik.
- Atomic Writes für `DECISIONS.md`, Konfiguration und State.
- Gute Fehlermeldungen, keine Stacktraces im normalen Betrieb.
- Unit-Tests für Parser, Markdown-Update und Repo-Erkennung.
- Integrationstest mit temporärem Workspace und zwei Mini-Git-Repos.

## Empfohlene Reihenfolge

1. Vorhandenes npm-Stub-Projekt inspizieren und sauber zu TypeScript-CLI ausbauen.
2. `amanos init` plus Tests implementieren.
3. Repo Discovery plus `amanos scan` implementieren.
4. Deterministischen Decision Parser bauen.
5. Append-only Update von `DECISIONS.md` bauen.
6. `amanos status` ergänzen.
7. Watcher mit Debounce ergänzen.
8. Vollständigen End-to-End-Test mit zwei Repos schreiben.
9. Erst dann den Codex-Adapter planen und implementieren.

## Definition of Done für V1

In einem Workspace mit zwei Git-Repositories kann ein Nutzer `amanos init`, danach `amanos scan` und `amanos watch` ausführen. Eine freie Markdown-Entscheidung wird automatisch als Eintrag in `DECISIONS.md` sichtbar; mögliche betroffene Dateien beider Repos werden angezeigt. Alles bleibt lokal, erklärbar und ohne Änderungen an fremdem Code.
