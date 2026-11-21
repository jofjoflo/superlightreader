# SuperLight Reader

Seriebibliotek och läsare som körs helt i webbläsaren – byggt för en Android-surfplatta (installeras som app), fungerar även på dator. Peka ut mappen med dina CBZ/CBR-filer så får du en hylla med serier, förlag, genrer, filter, rekommendationer och metadata från nätet. Ingen server, inga konton.

## Funktioner

- **Hylla.** *Hem* (fortsätt läsa, nästa nummer, rekommenderat för dig, nyligen tillagt, förlags- och genrerader), *Bibliotek* (sök + filter på förlag, genre, årtionde, status och typ, sortering, rutnätsstorlek), *Förlag*, *Serie* (beskrivning, skapare, betyg, favorit, nummerlista, liknande serier) och *Inställningar*.
- **Läsare.** Uppslag med två sidor i liggande läge, höger-till-vänster för manga, tryckzoner, svep, dubbeltryck- och nypzoom, tangentbord, framsteg sparas, "Nästa nummer", skärmen hålls vaken.
- **Filer.** CBZ (ZIP) samt CBR (RAR via WASM, mindre testat); bilder i AVIF, WebP, JPEG, PNG. Appen läser bara det som behövs (omslag, aktuell sida) – inte hela arkivet – så stora filer går bra.
- **Metadata utan API-nycklar.** `ComicInfo.xml` i filen, sedan filnamn/mappstruktur, sedan nätet: Wikipedia/Wikidata, AniList (manga), Google Books, Open Library. "Fel match?" på serien låter dig söka och välja manuellt.
- **Rekommendationer.** Lokalt och innehållsbaserat (genre, förlag, skapare, årtionde, titel, "liknande" från nätet, din läshistorik och dina betyg).
- **Offline.** Biblioteket (index, omslag, framsteg) ligger i IndexedDB. Filerna kan kopieras till appens egen lagring (OPFS) så du slipper välja mappen igen efter omstart.

## Kom igång (utveckling)

```bash
cd apps/reader
pnpm install
pnpm dev            # http://localhost:5173
```

Inga serier till hands? *Inställningar → Prova demodata* skapar ett syntetiskt bibliotek (≈110 nummer) i webbläsaren.

```bash
pnpm check          # svelte-check
pnpm test           # enhetstester (node:test)
pnpm build          # statisk sajt i apps/reader/build
```

## Publicera och använd på surfplattan

1. Lägg repot på GitHub.
2. Vercel → *Add New Project* → välj repot. Lämna *Root Directory* på repo-roten – [vercel.json](vercel.json) bygger `apps/reader` och serverar `apps/reader/build`.
3. Öppna Vercel-adressen i Chrome på surfplattan → ⋮ → **Installera app** / **Lägg till på startskärmen**.
4. Starta appen → **Lägg till serier** → *Välj mapp* (eller *Välj filer* om din webbläsare inte stöder mappval) → låt **Spara kopior i appen** vara ikryssad.

Går även bra på Netlify, Cloudflare Pages eller annan statisk host: `apps/reader/build` är en ren statisk SPA (alla adresser ska peka på `index.html`).

**Viktigt om https.** Offline-lagring (OPFS), installation som app och service worker kräver https (eller `localhost`). Över `http://<din-dator>:5173` på det lokala nätet fungerar läsning men du får välja mappen igen efter omstart. Vercel ger https automatiskt.

### Android-tips

- Mappval (`webkitdirectory`) stöds inte i alla Android-versioner. *Välj filer* ger ett alternativ när mappval inte fungerar; vilka filer som kan väljas beror på enheten och webbläsaren.
- *Spara kopior i appen* tar lika mycket plats som filerna. Stäng av det i *Inställningar* om utrymmet är knappt – då väljer du mappen igen efter omstart.
- Webbläsaren kan rensa lagring vid platsbrist: *Inställningar → Begär beständig lagring*. Behåll alltid originalfilerna.
- Metadata hämtas från Wikipedia, AniList m.fl. (serienamn skickas dit). Stäng av i *Inställningar* om du inte vill det.

## Metron och flyttbar säkerhetskopia

Lägg `metron_key` i `.env` i repots rot och starta om utvecklingsservern. På en seriesida kan du söka efter ett nummer hos Metron, granska träffen och spara karaktärer och skapare. Matchningen sparas lokalt tillsammans med biblioteket. Serienamn och nummer skickas till Metron vid sökning; nyckeln används bara av den lokala servern.

Metron-proxyn är avstängd på Vercel och i produktionsläge tills appen har åtkomstkontroll. En publik proxy utan inloggning skulle låta andra använda din Metron-kvot. En statisk preview har ingen lokal API-server; använd `pnpm run dev` för Metron lokalt.

Under **Inställningar → Säkerhetskopia** exporterar du bibliotek, metadata, lässtatus, läsordningar och inställningar som JSON. Importera filen på den andra enheten. Själva seriefilerna och omslagen ingår inte: välj samma filer igen för att länka dem. Befintliga uppgifter bevaras vid konflikter; inställningar importeras bara om du väljer det.

## Filnamn och mappar som känns igen

| Exempel | Tolkas som |
|---|---|
| `X-Men 020 (2025).cbz` | serie *X-Men*, nr 20, år 2025 |
| `Saga 001 (2012) (Digital) (Zone-Empire).cbz` | *Saga*, nr 1 (taggar ignoreras) |
| `Batman v3 012 (2017).cbz` | *Batman*, volym 3, nr 12 |
| `Berserk v03.cbz` · `One Piece - Vol. 12 - Titel.cbz` | volym som nummer |
| `Kalle Anka & C:o 2021-03.cbz` · `Fantomen Nr 12 2023.cbz` | nr 3 år 2021 · nr 12 år 2023 |
| `Watchmen.cbz` | fristående |
| `Serier/Marvel/X-Men (1991)/X-Men 001.cbz` | förlag *Marvel*, serie *X-Men*, startår 1991 |

`ComicInfo.xml` i arkivet (serie, nummer, förlag, genre, skapare, sammanfattning, Manga=höger-till-vänster, omslagssida, dubbelsidor) går före filnamnet.

## Projektstruktur

```
apps/reader            SvelteKit-app (Svelte 5, TypeScript, adapter-static, PWA)
  src/lib/             zip/rar-läsare, filnamnstolkning, skanning, serier, filter,
                       rekommendationer, metadata, lagring, store (library.svelte.ts)
  src/lib/components   delade UI-komponenter
  src/routes           Hem, Bibliotek, Förlag, Serie, Läsare, Inställningar
apps/tools/converter   Python-verktyg: bilder → AVIF → CBZ (se dess README)
docs/architecture.md   arkitektur och kontrakt mellan modulerna
```

## Konvertera serier till AVIF-CBZ (valfritt)

I appen: öppna **Inställningar → Konvertera till AVIF**, välj nummer och inställningar och hämta de färdiga CBZ-filerna. Efter import finns också en genväg via **Lägg till**. Originalen ändras inte. Bilderna kodas lokalt med kvalitetsförlust; `ComicInfo.xml` bevaras när den finns. Andra arkivfiler bevaras inte.

Konverteringen behandlar en sida i taget, men den färdiga filen lagras i minnet tills den hämtas. Stora böcker, särskilt CBR som läses in helt, kan kräva mer minne än en surfplatta har. Konvertera en fil i taget och spara resultatet innan nästa jobb.

**Från terminalen (många filer på en gång):** från projektets rotmapp, ge mappen. Alla `.cbz`- och `.cbr`-filer direkt i den konverteras, fyra åt gången:

```bash
source ~/.venvs/superlightreader/bin/activate
python -m apps.tools.converter --batch "$HOME/Downloads/Serier"
```

```
Serier/
  avif/      AVIF-versionerna (.cbz)
  notavif/   originalen, flyttade hit när konverteringen lyckats
```

Filer som inte kan läsas lämnas kvar i mappen, och en fil som redan finns i `avif/` skrivs aldrig över. Installation och alla alternativ finns i [konvertera-idag.md](docs/konvertera-idag.md).

## Begränsningar

- Testat i Chromium på dator. **Inte testat på riktig Android-enhet** (mappval, nypzoom/svep med fingrar, offline-lagring och app-installation).
- CBR/RAR läses in i minnet i sin helhet och är bara provat mot en liten testfil. PDF, EPUB och 7z stöds inte.
- Nätmetadata kan ge fel träff på udda titlar – rätta med *Fel match?* eller *Redigera uppgifter*.

## Licens

MIT.
