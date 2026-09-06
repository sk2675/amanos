# Prüfprotokoll für die Datenschutzhinweise

Status: **fachkundige rechtliche Prüfung ausstehend**

Erstellt: 6. September 2026

Dieses Protokoll dokumentiert die technischen Feststellungen und offenen Rechtsfragen zu Issue #25. Es ist keine Rechtsberatung und darf nicht als Nachweis einer bereits erfolgten fachkundigen Prüfung verwendet werden.

## Technisch geprüft

- Die Website wird gemäß `vercel.json` als statische Astro-Site durch Vercel bereitgestellt.
- Der veröffentlichte Quellcode bindet weder Vercel Web Analytics noch Vercel Speed Insights oder einen anderen Analyse-, Werbe- oder Trackingdienst ein.
- Die Website setzt selbst keine Cookies und greift nicht auf Local Storage oder Session Storage zu.
- Schriftarten, Bilder, Symbole und Stylesheets werden nicht automatisch von Drittanbieter-Domains geladen.
- Der einzige externe Link im gemeinsamen Layout führt zu GitHub und verwendet `noopener noreferrer`.
- Im Quellcode und in der Deployment-Konfiguration ist kein zusätzlicher Log-Drain eingerichtet. Der Vercel-Tarif ist dort nicht dokumentiert; deshalb nennt die Seite transparent sämtliche aktuellen tarifabhängigen Runtime-Log-Fristen.
- Die CLI enthält keine Telemetrie- oder Netzwerkintegration. Repository-, Homepage- und Registry-URLs in `package.json` sind reine Paketmetadaten.
- Die Content-Prüfung blockiert bekannte Analytics-, Tracking-, externe Ressourcen-, Cookie- und Browser-Speicher-Signale, bis die Datenschutzhinweise und die Prüfregel bewusst aktualisiert werden.

## Herangezogene Anbieterunterlagen

- [Vercel Privacy Notice](https://vercel.com/legal/privacy-notice), Stand 1. Juni 2026
- [Vercel Data Processing Addendum](https://vercel.com/legal/dpa), Stand 17. März 2026
- [Vercel Runtime Logs](https://vercel.com/docs/logs/runtime), mit tarifabhängigen Speicherfristen

## Checkliste für die fachkundige Prüfung

- [ ] Verantwortlichen, Anschrift und Kontaktweg bestätigen.
- [ ] Tatsächlichen Vercel-Tarif und aktivierte Dashboard-Funktionen (einschließlich Log Drains, Web Analytics, Speed Insights und Observability Plus) im Vercel-Konto gegen die veröffentlichten Angaben prüfen.
- [ ] Vertragsrolle von Vercel, Abschluss/Geltung eines Auftragsverarbeitungsvertrags und die gewählten Garantien für Drittlandübermittlungen prüfen.
- [ ] Datenkategorien, berechtigte Interessen, Rechtsgrundlagen und Speicherfristen rechtlich bewerten.
- [ ] Zuständigkeit des BayLDA und die Vollständigkeit der Betroffenenrechte bestätigen.
- [ ] Verarbeitung eingehender E-Mails einschließlich eingesetzter Mailanbieter und tatsächlicher Löschpraxis prüfen.
- [ ] Reviewer, Prüftermin, festgestellte Änderungen und Freigabenachweis in Issue #25 dokumentieren.

Die technische Prüfung kann tatsächliche Einstellungen im nicht öffentlichen Vercel-Konto und eine fachkundige rechtliche Bewertung nicht ersetzen.
