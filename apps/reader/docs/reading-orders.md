# Läsordningar

Importera JSON via **Läsordningar**. Filer sparas endast i webbläsarens lokala lagring på aktuell enhet.

`title` och `items` krävs. Varje post kräver `series`; `issue`, `volume` och `year` begränsar matchningen. `story`, `note`, `essential` och `url` är valfria.

Matchning är avsiktligt konservativ: serienamn jämförs exakt (skiftläge och extra blanksteg ignoreras), och ett nummer öppnas först när exakt en serie och exakt ett nummer passar. Saknade och tvetydiga poster lämnas synliga utan automatisk gissning. Lässtatus kommer från bibliotekets befintliga progressdata.

```json
{
  "title": "Saga – föreslagen ordning",
  "description": "Läs huvudserien före de två spin-off-serierna.",
  "year": 2024,
  "characters": ["Alana", "Marko"],
  "sourceUrl": "https://example.org/reading-order",
  "items": [
    { "series": "Saga", "issue": 1, "story": "Chapter One", "essential": true },
    { "series": "Saga", "issue": 2, "note": "Fortsätt direkt", "essential": true },
    { "series": "Saga: Supplement", "issue": 1, "url": "https://example.org/supplement" }
  ]
}
```
