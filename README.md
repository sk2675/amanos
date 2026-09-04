# amanos

**Entscheidungen, die nicht versanden.**

Amanos wird ein lokales Entscheidungs-Gedächtnis für Vibe-Coding. Es erkennt Projektentscheidungen in freien Notizen, hält sie nachvollziehbar fest und findet mögliche Auswirkungen über mehrere Git-Repositories hinweg.

Aktuell enthält dieses Repository ausschließlich die Website. Das npm-CLI folgt später.

## Repository

```text
amanos/
  site/                 # Landingpage für amanos.dev
  package.json          # reserviert für das spätere npm-CLI
  README.md
```

## Website lokal starten

```bash
cd site
npm install
npm run dev
```

Die Landingpage wird mit Astro gebaut. Der Produktions-Build landet statisch in `site/dist/` und wird über das verbundene Vercel-Projekt veröffentlicht. Die Root-Konfiguration in `vercel.json` beschränkt Installation, Build und Ausgabe ausdrücklich auf `site/`; das spätere npm-CLI bleibt vollständig außerhalb des Website-Deployments.

## Späteres npm-Paket

Das Root-Paket ist noch privat und enthält bewusst keine CLI-Implementierung. Sein `files`-Feld ist bereits auf `dist` beschränkt, damit `site/` bei einer späteren npm-Veröffentlichung nicht im Paket landet.

## Prinzipien

- local-first, ohne eigenen Cloud-Service
- nachvollziehbare Quellen und Sicherheitswerte
- keine automatischen Pushes oder Merges
- eine gemeinsame Wahrheit in `DECISIONS.md`
