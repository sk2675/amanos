# V1: lokales Entscheidungs-Gedächtnis für Vibe-Coding

## Das Problem

Beim Vibe-Coding entstehen wichtige Entscheidungen in freien Markdown- oder HTML-Notizen und in Grilling-Sessions. Diese Entscheidungen werden nicht zuverlässig in allen betroffenen Repositories umgesetzt. Dateien werden später gelöscht oder ändern sich, Kontext geht verloren und Website, App, Billing und Dokumentation laufen auseinander.

## Die Idee

Ein lokales npm-Tool beobachtet einen Workspace mit mehreren Git-Repositories. Es erkennt Entscheidungen aus freiem Text, hält sie in einer zentralen `DECISIONS.md` fest, findet Auswirkungen in allen Repositories und lässt einen vorhandenen Coding-Agenten die erforderlichen Änderungen lokal vorbereiten.

Die zentrale Datei ist nicht nur Dokumentation, sondern der laufende Zustand der Projektentscheidungen und ihrer Umsetzung.

## V1-Workflow

1. Der Nutzer startet einmalig `tool watch <workspace>`.
2. Der Watcher beobachtet freie `.md`- und `.html`-Dateien im Workspace.
3. Nach 60 Sekunden ohne weitere Änderungen analysiert ein installierter Coding-Agent den neuen Inhalt.
4. Die AI extrahiert Entscheidungen, Annahmen, offene Versprechen und Quellen.
5. Neue Entscheidungen landen standardmäßig sofort als `aktiv` in `<workspace>/DECISIONS.md`; die Vertrauensregel ist konfigurierbar und kann unsichere Entscheidungen als `entwurf` markieren.
6. Das Tool durchsucht automatisch alle Git-Repositories unterhalb des Workspace und ermittelt betroffene Dateien, Systeme und Folgearbeiten.
7. Für jede Auswirkung erstellt der Coding-Agent einen eigenen lokalen Git-Branch, schlägt Änderungen vor bzw. führt sie aus, startet passende Tests und committet erfolgreiche Änderungen lokal.
8. Push und Merge passieren niemals automatisch.
9. Bei Testfehlern bleiben Branch und Commit erhalten; der Eintrag in `DECISIONS.md` wird als `blockiert` markiert und enthält den Fehler sowie den nächsten sinnvollen Schritt.

## Beispiel für `DECISIONS.md`

```md
## D-014 — Pro-Plan kostet 29 €

Status: aktiv
Sicherheit: 87 %
Quelle: notes/pricing-grilling.md#L42-L58

### Erkannte Auswirkungen

- [x] app-repo: Plan-Konfiguration aktualisiert (`decision/D-014-pricing`)
- [ ] website-repo: Pricing-Seite und FAQ anpassen
- [ ] billing: Stripe-Preis-ID prüfen

Nächster Schritt: Website-Branch nach Prüfung mergen.
```

## Grenzen und Schutzmechanismen

- Local-first: Workspace, Index, Entscheidungen und Git-Branches bleiben lokal.
- Das Tool verwendet den bereits installierten Agenten, etwa Codex oder Claude Code; kein eigener API-Key-Zwang.
- Keine stillen Änderungen im aktuellen Arbeitsbranch.
- Keine automatischen Pushes oder Merges.
- Jede Entscheidung verweist auf ihre Textquelle und hat einen sichtbaren Sicherheitswert.
- Die Wartezeit verhindert Ausführung mitten im Schreiben oder Grilling.

## Bewusster V1-Scope

- Ein Workspace-Ordner, beliebig viele lokale Git-Repositories darunter.
- Freitext-Erkennung aus Markdown und HTML.
- Ein zentraler `DECISIONS.md`-Eintrag im Workspace-Root.
- Zunächst ein Agent-Adapter (idealerweise Codex); weitere Adapter später.
- Kein Web-Dashboard und keine Cloud.

## Kernversprechen

Eine Entscheidung bleibt nicht als Notiz zurück. Sie wird als nachvollziehbare, getestete Änderung über alle betroffenen Repositories weitergetragen.
