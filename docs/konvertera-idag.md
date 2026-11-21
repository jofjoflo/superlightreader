# Konvertera CBZ/CBR till AVIF-CBZ

Det här är den separata Python-konverteraren. Appen har också en konverterare (Inställningar → Konvertera till AVIF) som gör samma sak för enskilda filer i webbläsaren.

## Installera (en gång)

Öppna Terminal och kör följande från projektets rotmapp:

```bash
cd ~/Documents/kod/superlightreader
python3 -m venv "$HOME/.venvs/superlightreader"
source "$HOME/.venvs/superlightreader/bin/activate"
pip install -r apps/tools/converter/requirements.txt
```

CBR (RAR) kräver inget extra på macOS: konverteraren använder `bsdtar`, som ingår i systemet. Finns inte `bsdtar` används `unar`, `unrar` eller `7z` i stället. Kontrollera med `python -m apps.tools.converter --check-cbr`.

## Konvertera en hel mapp (batch)

Ge mappen. Alla `.cbz`- och `.cbr`-filer som ligger direkt i den konverteras. Undermappar söks inte igenom.

```bash
python -m apps.tools.converter --batch "$HOME/Downloads/Exempel"
```

Efter körningen ser mappen ut så här:

```
Exempel/
  avif/      AVIF-versionerna, samma namn, .cbz
  notavif/   originalen, flyttade hit
```

- Filer konverteras fyra åt gången. Ändra med `--jobs 2`.
- Standard är `--quality 40 --max-width 1400`. Sidor bredare än 1400 px skalas ner, övriga lämnas. `--max-width 0` behåller originalstorleken.
- Originalet flyttas först när den nya filen är klar och kontrollerad. Om en fil misslyckas lämnas både originalet och eventuella delresultat orörda, och felet skrivs ut. En fil där någon sida inte går att läsa konverteras inte alls.
- En fil som redan finns i `avif/` eller `notavif/` hoppas över och skrivs aldrig över. Du kan köra igen efter att du lagt till nya filer.
- `ComicInfo.xml` kopieras till den nya filen när alla sidor konverterats.

Varje fil får en rad i utskriften, till exempel:

```
[2/9] OK    Absolute Superman 017 2026 Digital.cbz  23 sidor, 51,3 → 3,0 MB, 9 s
```

Öppna några filer i `avif/` i läsaren och kontrollera dem innan du tar bort något. Originalen ligger kvar i `notavif/`.

## Konvertera en fil

```bash
python -m apps.tools.converter \
  --src "$HOME/Downloads/Exempel/original.cbz" \
  --dst "$HOME/Downloads/Exempel/original AVIF.cbz" \
  --quality 40 --max-width 1400
```

Använd olika namn för källa och mål, eftersom ett befintligt mål skrivs över. Originalet behålls. Utelämna `--max-width 1400` för att behålla originalbredden.

## Begränsningar

- AVIF är förlustbaserat. `--lossless` ger större filer.
- Endast sidor och `ComicInfo.xml` tas med. Annat i arkivet (text, PDF) försvinner.
- RAR-filer packas upp i sin helhet till en tillfällig mapp, så stora CBR-filer behöver ledigt diskutrymme motsvarande filens storlek.
