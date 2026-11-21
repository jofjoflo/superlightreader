# Komma igång

Se [README](../README.md) för funktioner, publicering på Vercel och användning på Android-surfplatta, och [architecture.md](architecture.md) för hur modulerna hänger ihop.

## Snabbstart

```bash
cd apps/reader
pnpm install
pnpm dev            # öppna http://localhost:5173
```

1. Öppna appen → **Prova med demodata** (eller *Välj mapp* / *Välj filer* med dina egna serier).
2. Bläddra på *Hem*, *Bibliotek* och *Förlag*; tryck på en serie och sedan *Börja läsa*.

## Konvertera egna bilder till CBZ

```bash
cd apps/tools/converter
pip install -r requirements.txt
python demo.py                                   # skapar demo_comic.cbz
python -m converter --src ./kapitel1 --dst ./kapitel1.cbz --quality 50
```

Flaggor: `--quality 40–60` (bra balans), `--max-width 1400` för skärmläsning, `--lossless` för arkiv. Lägg gärna en `ComicInfo.xml` i mappen – appen läser serie, nummer, förlag, genre och sammanfattning därifrån.

## Felsökning

- **Ingen miniatyr / "kan inte läsas":** arkivet är trasigt, krypterat eller (CBR) av ett RAR-format som inte stöds. Se felmeddelandet på seriesidan.
- **"N nummer är inte länkade":** filerna finns i biblioteket men webbläsaren har tappat åtkomsten. Välj mappen igen, eller slå på *Spara kopior i appen* (kräver https).
- **AVIF visas inte:** uppdatera webbläsaren eller konvertera till JPEG/WebP.
- **Fel metadata:** serien → *Fel match?* eller ⋯ → *Redigera uppgifter*.
