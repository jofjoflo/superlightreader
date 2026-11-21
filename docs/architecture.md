# Arkitektur – SuperLight Reader (web)

Statisk SPA (SvelteKit + `adapter-static`, `ssr=false`). Ingen backend. Allt körs i webbläsaren, tänkt för Android-surfplatta (Chrome) + desktop.
Hostas på valfri statisk host (Vercel/Netlify). PWA: installeras på hemskärmen.

Kod: `apps/reader/src`. **Kontraktet är `src/lib/types.ts`** (läs det först). Moduler har kompilerbara stubbar med slutgiltiga signaturer – ändra inte exporterade signaturer, lägg gärna till exports.

## Dataflöde

```
Filväljare/drop ──► pick.ts (ScanInput[]) ──► scan.ts ──► archive.ts (zip.ts/rar.ts) + parse/* + covers.ts
                                                  │ onIssue(issue, cover)
                                                  ▼
                             library.svelte.ts (reaktiv store)  ──► db.ts (IndexedDB, idb-keyval)
                                   │  files.ts (OPFS-kopior)         covers = Blob i IDB
                                   │
        series.ts (buildSeries) ◄──┤──► metadata/* (Wikipedia/Wikidata, AniList, Google Books, Open Library)
        filter.ts / recommend.ts ◄─┘
                                   ▼
                  routes/* + lib/components/*  (Svelte 5 runes UI)
```

* Issue-id = `hash(filnamn|storlek)` → stabilt mellan sessioner. Omskanning hoppar över kända (`known`) men länkar om filen.
* Bibliotek + omslag (webp ≤400px) + läsprogress ligger i IndexedDB → hyllan visas direkt vid start.
* Själva filerna: antingen (a) kopierade till OPFS (`settings.persistFiles`, default på) → allt läsbart offline utan omval, eller (b) bara i minnet för sessionen → "Länka om"-flöde.
* Android Chrome: `<input webkitdirectory>` kan saknas → fallback `multiple`-filval. **Sätt aldrig `accept`** på input (Android greyar .cbz) – filtrera på filändelse i JS.

## Konventioner (alla)

* Svelte 5 **runes** (`$state/$derived/$effect/$props`, snippets, `onclick={}`) – inte `$:`/`on:click`. TypeScript överallt. UI-text på **svenska**, kommentarer på engelska, korta.
* Rena moduler (`parse/*`, `zip.ts`, `archive.ts`, `rar.ts`, `series.ts`, `filter.ts`, `recommend.ts`, `metadata/*`, `util.ts`): endast **erasable TS** (inga enums/namespaces/parameter-properties), relativa imports **med `.ts`-ändelse**, `import type` för typer, inga `$lib`/`$app`, ingen åtkomst till `window/document/navigator` vid import. Då kör `node --test` dem.
* Tester: `src/lib/**/<namn>.test.ts` med `node:test` + `node:assert/strict`. Kör `pnpm test`.
* Typkoll: `pnpm check 2>&1 | grep -E "<dina filer>"` (andras halvfärdiga filer kan ge fel – ignorera).
* Minimalism: ingen spekulativ kod, inga nya beroenden, inga extra abstraktioner. Kort och korrekt.
* Ändra bara dina egna filer. Rör inte `package.json`, `svelte.config.js`, `types.ts`, `util.ts`, `app.css`, `library.svelte.ts` (ägs av orkestratören) – saknas något, notera det i slutrapporten.

## Seriegruppering (parse/*)

`parseFileName`: ta bort ändelse; ta bort parentes-/hakparentes-taggar (`(Digital)`, `[Zone-Empire]`, `(c2c)`, `(of 04)`, `(2 covers)`); `(YYYY)` (1900–2099) → `year`; `_`/`.` mellan ord → mellanslag (bara om inga mellanslag finns). Nummer = **sista fristående numeriska token** efter serienamnet: `#12`, ` 012`, `Chapter 12`/`Ch. 12`/`Issue 12`/`No. 12`/`Nr 12`/`Nummer 12`/`Vol. 3`/`v03` (volym räknas som nummer om inget annat nummer finns; annars `volume`), decimaler `1.5`. `YYYY-NN` (t.ex. `Kalle Anka 2021-03`) → year=2021, number=3. Fristående 4-siffrigt år som inte är sist hör till namnet (`Spider-Man 2099 001` → serie "Spider-Man 2099", nr 1; `100 Bullets 001` → "100 Bullets"). `Annual`/`Special` → kind. Inget nummer → `oneshot`. ` - Titel` efter numret → `title`. Serien är namnet före numret, trimmat.

`parsePath(relPath)`: segment = `relPath.split('/')`. `folderSeries` = föräldramappens namn (år/taggar bortrensade) **om** mappen inte är generisk (`comics, comic, serier, series, tidningar, böcker, books, downloads, download, nedladdningar, dokument, documents, manga, library, bibliotek, new, nya, …` eller ett förlagsnamn) **och** filnamnets serie är tom/börjar med siffra/är del av eller innehåller mappnamnet (normaliserat, case-/accent-okänsligt). Annars vinner filnamnet. `volumeYear` = `(YYYY)` i mappnamnet när mappen används som serie. `publisher` = första förfader-mapp som är ett känt förlag (`normalizePublisher` + `isKnownPublisher`).

`seriesKey(name, volume?, volumeYear?)` = `slugify(namn utan inledande the/a/an/en/ett)` + (`volume>1` ? `-v{volume}` : '') + (`volumeYear` ? `-{volumeYear}` : ''); tom slug → `s-{hash(name)}`.
`seriesDisplayName` se stub.

Prioritet i scan: ComicInfo (`series`, `number`, `volume`, `year`, `publisher`) > `parsePath.folderSeries`/filnamn. Publisher: `normalizePublisher(info.publisher) ?? path.publisher`.

## Zip (zip.ts + archive.ts)

Slumpåtkomst via `Blob.slice`, **aldrig** `unzipSync` på hela filen. Läs sista ≤66 KB → hitta EOCD (`0x06054b50`) bakifrån; ZIP64 (`0x07064b50` locator → `0x06064b50` record, extra-fält `0x0001` när fält = `0xFFFFFFFF`/`0xFFFF`). Parsa central directory (`0x02014b50`): flaggor (bit 0 = krypterad → fel, bit 11 = UTF-8), metod (0 store, 8 deflate), storlekar, namn, local-header-offset. Läsa post: läs local header (30 B) för *dess* namn-/extralängd → datastart. **Store** → `blob.slice(start,end,mime)` utan kopia. **Deflate** → `inflateSync` (fflate) på slicen. Sidor = bildposter (`avif|webp|jpe?g|png|gif|bmp`), exkludera `__MACOSX/`, `._*`, `Thumbs.db`, mappposter; naturlig sortering på hela sökvägen (`naturalCompare`). `readText` = basename, skiftlägesokänsligt, utf-8 (strippa BOM). `openArchive` sniffar magic (`PK\x03\x04`/`PK\x05\x06` → zip, `Rar!` → `await import('./rar.ts')`).

## Serie-derivering (series.ts)

Gruppera på `issue.seriesId`. Sortera issues: `volume`, `number` (undefined sist), `year`, `fileName` (naturlig). `name`: `meta.name` ?? `issues[0].seriesName`; om två serier får samma `name`, lägg ` (startÅr)` på båda (eller ` (förlag)` om år saknas). `sortKey`: lowercase utan inledande artikel. `publisher`: `meta.publisher` (om `userEdited`) ?? majoritetsröst av `issue.publisher` ?? `meta.publisher` ?? `UNKNOWN_PUBLISHER`. `genres`/`creators`: union (issue-data först, sen meta), max 12 respektive 10. `startYear`: `meta.startYear` ?? min(issue.year). `description`: `meta.description` ?? första `issue.summary`. `coverIssueId`: första issue med `hasCover` (annars första). `color`: från cover-issue. `addedAt`: max. `lastReadAt`: max `progress.updatedAt`. `completedCount`: antal `completed`. `progress`: (completed + andel av pågående)/antal, 0..1. `state`: `done` om alla klara, `reading` om något påbörjat/klart, annars `unread`. `inProgressIssueId`: senaste issue med `page>0 && !completed`. `nextIssueId`: inProgress ?? första ej klara issue **efter** senast klara (annars första ej klara) ?? första issue. `rtl`: `meta.rtl` ?? någon issue `rtl`. `oneShot`: 1 issue utan `number`. `complete`: ≥2 numrerade issues och heltalsnummer sammanhängande från 0 eller 1 till max utan luckor. `matched`: `!!meta?.source && !meta.notFound`.

## Filter (filter.ts)

`q`: skiftläges-/accentokänslig substring mot namn, förlag, genrer, skapare. Flerval (`publishers`/`genres`/`decades`): OR inom gruppen, AND mellan grupper. `status`: favorites = `favorite`. `kind`: `series` = !oneShot, `manga` = rtl, `complete` = complete. Sortering: `name` (sortKey, sv-kollation), `added`, `read` (lastReadAt), `year` (startYear), `issues`, `rating`, `progress`; `desc` vänder; saknade värden alltid sist; stabil (tie → sortKey).

## Rekommendationer (recommend.ts)

Innehållsbaserat, helt lokalt. Features per serie: genrer, förlag, skapare, årtionde, namn-tokens (stoppord bort, så "X-Men" ≈ "Uncanny X-Men"), `related`-titlar (meta; stark boost om titel matchar en annan serie i biblioteket), manga/rtl.
* `similarSeries`: viktad Jaccard/cosine; `why` = de 1–2 starkaste skälen på svenska ("Samma förlag: Marvel · Genre: Sci-fi").
* `recommendForYou`: profil = viktad summa av features från serier med engagemang (`progress`, `favorite`, `rating` (3 = neutral, 1–2 negativt), recency-decay). Kandidater = ej klara/ej dolda serier. `why` = "Du gillar {topp-feature}" eller "Liknar {serie}". Tom lista utan historik.
* `buildHomeRows` (hoppa över tomma): `continue` ("Fortsätt läsa", issues, senast läst först) → `next` ("Nästa nummer", issues: nästa olästa i serier där inget är påbörjat) → `foryou` ("Rekommenderat för dig") → upp till 2× `because` ("Eftersom du läste {X}") → `favorites` ("Dina favoriter") → `new` ("Nyligen tillagt") → `starters` ("Bra ställen att börja": olästa serier där nr 1/oneshot finns; ej historik-beroende; deterministisk ordning) → `complete` ("Kompletta serier") → upp till 4× förlag ("Mer från {förlag}", `href: /library?publisher=…`) → upp till 4× genre ("{Genre}", `href: /library?genre=…`) → `classics` ("Klassiker", startYear < 1990). Max ~18 per rad; en serie får inte dominera: samma serie visas max 3 rader totalt utöver förlag/genre.

## Metadata (metadata/*)

Endast CORS-vänliga, nyckellösa källor (verifiera varje med `curl -sI -H 'Origin: https://example.com' <url>` och titta efter `access-control-allow-origin`):
1. **Wikipedia/Wikidata** (en, fallback sv): sök (`action=query&list=search&origin=*` eller REST) → sidans `summary` (beskrivning/extract) + Wikidata-entitet (`pageprops.wikibase_item` → `wbgetentities&origin=*`): P123 förlag, P136 genre, P50/P170 skapare, P571/P577 start, P582 slut, P31 för att verifiera att det är en serie/mangaserie/serieroman. Kräv att resultatet *är* serie-relaterat (P31 ∈ comic book series/manga series/comic strip/graphic novel/web comic/fiktivt-universum-undantag) – annars ratta bort (annars matchar "Batman" filmer).
2. **AniList GraphQL** (`https://graphql.anilist.co`, POST, MANGA): titel (romaji/english/native), description (HTML → text), genres, startDate, status, staff, `recommendations` → `related`.
3. **Google Books** (`volumes?q=intitle:…`, kategori "Comics & Graphic Novels") → publisher, publishedDate, description, categories.
4. **Open Library** (`search.json`) → publisher, first_publish_year, subject.
Matchscore = normaliserad titellikhet (token-Jaccard + prefix) + bonus för år/förlag-träff − straff för "(film)/(TV)/(video game)". Auto-accept ≥ 0.72. Beskrivningar: ren text, ≤ 700 tecken, avkapad vid meningsslut. Förlag via `normalizePublisher`. Timeouts 8 s (AbortSignal.timeout), max 2 samtidiga anrop totalt, inga anpassade headers (undvik preflight). Offline/nätfel ≠ notFound.

## UI-språk & design

Mörkt, kontrastrikt, "serietidningshylla": djupa blå-svarta ytor, orange→gul accent, stora 2:3-omslag med mjuka skuggor, staplad-kant-effekt för serier med flera nummer, tunn progressbar längst ned på kortet. Tokens + utilities finns i `src/app.css` (`.btn .btn-primary .chip .card .grid-cards .scroll-x .page .h1 .h2 .muted`). Touchmål ≥ 44 px. Layout: sidorail (≥ 900 px bredd) / bottenmeny (< 900 px). Läsaren är helskärm utan shell.

---

# UI-spec

## Rutter (SvelteKit, pathname-routing, SPA)

| Route | Fil | Not |
|---|---|---|
| `/` | `routes/+page.svelte` | Hem: hero + rekommendationsrader |
| `/library` | `routes/library/+page.svelte` | Filter + rutnät. URL-params via `filtersFromParams/ToParams` (`?publisher=Marvel&genre=Sci-Fi&q=…`) |
| `/publishers` | `routes/publishers/+page.svelte` | Förlagsrutnät |
| `/series/[id]` | `routes/series/[id]/+page.svelte` | Serie-detalj |
| `/read/[id]` | `routes/read/[id]/+page.svelte` | Läsare, helskärm, **ingen shell** |
| `/settings` | `routes/settings/+page.svelte` | Inställningar |
| (layout) | `routes/+layout.svelte` | Shell |

Länkar är vanliga `<a href="/series/{id}">` (SvelteKit-router tar över). Navigera i kod med `goto` från `$app/navigation`, läs route/URL med `page` från `$app/state` (`page.params.id`, `page.url.searchParams`, `page.route.id`).

## Store: `import { library } from '$lib/library.svelte'`

Läs **headern i `src/lib/library.svelte.ts`** – hela publika API:t finns där. Kortversion:
* Reaktivt: `ready`, `issues`, `series` (Series[]), `seriesById`, `issueById`, `facets`, `homeRows` (RecRow[]), `settings`, `scan`, `metaJob`, `unlinked`, `storage`, `covers`, `linked`.
* Läs: `getSeries(id)`, `getIssue(id)`, `coverUrl(issueId)`, `progressOf(issueId)`, `isLinked(issueId)`, `await getFile(issueId)`.
* Åtgärder: `pick('folder'|'files')` (**anropas direkt i klick-handler**), `addFiles`, `addDemo`, `saveProgress(issueId,page,pageCount)`, `markIssues(ids,read)`, `markSeriesRead(id,read)`, `toggleFavorite(id)`, `setRating(id,n)`, `setSeriesMeta(id,patch)`, `applyCandidate(id,c)`, `enrichSeries(id,{force})`, `enrichMissing(force)`, `cancelMeta()`, `removeSeries(id)`, `removeIssues(ids)`, `clearAll()`, `updateSettings(patch)`, `updateReader(patch)`, `persistStorage()`, `clearCopies()`, `metaQuery(series)`.
* Övrigt: `toast.show(msg,{kind,action})` (`$lib/toast.svelte`), `ui.addOpen`/`ui.installEvent` (`$lib/ui.svelte`), rena funktioner: `applyFilters/computeFacets/filtersFromParams/filtersToParams/defaultFilters` (`$lib/filter`), `similarSeries` (`$lib/recommend`), `searchMeta` (`$lib/metadata`), `publisherColor` (`$lib/parse/publishers`).
* Importera inte `.ts`-moduler med `.ts`-ändelse i Svelte-filer; använd `$lib/...` utan ändelse (utom `$lib/library.svelte`, `$lib/toast.svelte`, `$lib/ui.svelte`).

## Delade komponenter (`src/lib/components/*.svelte`)

Props är fastlåsta av stubbarna (läs dem). Ägs av **UI-core-agenten**; sidagenterna *använder* dem och får inte ändra dem. `Icon` (inline-SVG, alla namn i `IconName`), `Cover`, `SeriesCard`, `IssueCard`, `Shelf`, `Chip`, `ProgressBar`, `Sheet`, `AddSheet`, `EmptyState`, `RatingStars`, `PublisherTile`, `ScanBanner`. `MetaPicker` ägs av serie-sidans agent.

## Designkrav (gäller alla)

* Känsla: premium, "streaming-app för serier": mörka lager (`--bg/--surface*`), accent-gradient `--accent→--accent-2` sparsamt (primärknappar, progress, aktiva chips), stora omslag med mjuk skugga (`--shadow-card`), blur-bakgrunder av omslag (`filter: blur(40px) saturate(1.4)` + gradient mot `--bg`), tunna progressbars, skelett-laddning (`.skeleton`), små tryck-animationer (`transform: scale(.97)` på `:active`), subtila `fade/slide`-övergångar (kort, `--ease`, respektera `prefers-reduced-motion`).
* Surfplatta först (landskap 1280×800 och porträtt 800×1280), men måste fungera ner till 360 px och upp till 2560 px. Rutnät med `.grid-cards` (`--card-min` sätts i shell från `settings.cardSize`). Touchmål ≥ 44 px, inga hover-beroende funktioner, `:focus-visible` syns.
* Använd tokens/utilities från `app.css` (`var(--surface)`, `.btn`, `.btn-primary`, `.chip`, `.card`, `.h1/.h2`, `.muted`, `.scroll-x`, `.page`, `.clamp-N`). Egna stilar som scopade `<style>` i komponenten. **Ändra inte `app.css`.** Inga externa fonter/CDN/bibliotek, inga nya beroenden.
* All text på svenska ("Fortsätt läsa", "Nästa nummer", "Oläst", "Pågående", "Läst", "Favoriter", "Förlag", "Genre", "Sortera", "Rensa", "Spara", "Avbryt", "Ta bort"…). Tomma tillstånd och fel ska ha en hjälpsam text och en åtgärdsknapp.
* Tillgänglighet: semantiska element (`<button>`, `<a>`, `<nav>`, `<main>`), `aria-label` på ikonknappar, `alt` på bilder (tom för dekorativa).
* Prestanda: inga tunga beräkningar i render; `$derived` för härledda listor; `loading="lazy"` + `decoding="async"` på omslagsbilder; `content-visibility: auto` + `contain-intrinsic-size` på kort i långa rutnät.
* Svelte 5 runes överallt; `{#each items as it (it.id)}` med nycklar; snippets för barn-innehåll.
* Verifiera med `pnpm check 2>&1 | grep -E "<dina filer>"`. Använd **inte** webbläsarverktyg (orkestratören gör visuell QA i en gemensam webbläsare) och starta ingen dev-server.

## Per sida

**Shell (`+layout.svelte`)**: importera `../app.css`; `library.init()` i `onMount`; `--card-min` = `settings.cardSize`px på rot-elementet. Bredd ≥ 900 px: vänster **rail** (logotyp överst, ikon+etikett: Hem, Bibliotek, Förlag, Inställningar, accent-markering för aktiv route, "+ Lägg till" längst ned som primärknapp → `ui.addOpen = true`). Smalare: **bottenmeny** (4 flikar + mittknapp "+"), `padding-bottom: env(safe-area-inset-bottom)`. Topbar (sticky, `backdrop-filter: blur`, höjd `--topbar-h`): sökfält ("Sök serier, förlag, genre…"; Enter → `goto('/library?q=…')`; på `/library` hanterar sidan sitt eget sökfält så göm då topbarens), och "Installera"-chip om `ui.installEvent`. Fånga `beforeinstallprompt` (preventDefault, spara i `ui.installEvent`) och `appinstalled` (nolla). Banner under topbaren när `library.unlinked > 0 && !library.scan.active && library.issues.length > 0`: "N nummer är inte länkade till filer – välj mappen igen" + knapp "Välj mapp" (`library.pick('folder')`) (göm om alla olänkade är `unsupported`). `<ScanBanner/>`, `<AddSheet open={ui.addOpen} onclose=…/>`, toasts (`toast.items`, högt z-index, `aria-live="polite"`, valfri action-knapp). Mappdrop på fönstret (`dragover/drop`): `inputsFromDrop(e.dataTransfer)` → `library.addFiles`, overlay "Släpp mappen här". Route `page.route.id?.startsWith('/read')` → rendera ENBART `children` (ingen rail/topbar/banner/bottenmeny). Innehållsyta: `<main>` med padding-left `--nav-w` på bred skärm.

**Hem (`/`)**: se nedan "Hem". **Bibliotek**: sticky filterrad: sökfält (`q`), statuschips (Alla/Oläst/Pågående/Läst/Favoriter), typchips (Alla/Serier/Engångs/Manga/Kompletta), knappar "Förlag", "Genre", "Årtionde" som öppnar `Sheet` med chip-flerval + antal, sortering (`<select>` + riktningsknapp), rutnätstäthet (range → `updateSettings({cardSize})`), "Rensa (N)" när `countActiveFilters>0`, resultaträknare "86 serier". Filterstate = `$state` initierat från URL, synkas tillbaka med `goto(url,{replaceState:true,keepFocus:true,noScroll:true})` (debounce 250 ms på `q`). Facetter från `library.facets` (eller `computeFacets` över filtrerat urval utan den egna gruppens filter). Tomt resultat → EmptyState + "Rensa filter". Tomt bibliotek → EmptyState + "Lägg till serier". **Förlag**: rutnät av `PublisherTile` (alla förlag från `facets.publishers`, `UNKNOWN_PUBLISHER` sist) med sökfält som filtrerar förlagsnamn; tile-data: seriesCount = facet.count, issueCount = summan av `issueCount` för serierna, coverIssueIds = `coverIssueId` för 3 första serierna med omslag.

**Hem (`/`)**: skelett tills `library.ready`. Tomt bibliotek → välkomst-hero (stor logotyp-glyph, "Välkommen till SuperLight Reader", "Välj mappen där dina serier ligger. Allt stannar på din enhet.", primärknapp "Välj mapp" → `library.pick('folder')`, sekundär "Välj filer" → `library.pick('files')`, textlänk "Prova med demodata" → `library.addDemo()`, tips: "Fungerar inte mappval? Välj flera filer i stället."). Annars: **Hero** (full bredd, ~42vh, blur-bakgrund av omslaget, skarpt omslag till vänster, text till höger): finns rad `continue` → första itemet ("Fortsätt läsa", serienamn, "Nummer N · Sida X av Y", ProgressBar, knappar "Fortsätt läsa" → `/read/{id}` och "Till serien"); annars första serien i `foryou`/`starters` ("Börja läsa", beskrivning clamp-3, "Läs nr 1"). Under: en rad med statistik ("142 serier · 1 203 nummer · 12 förlag"), sedan **alla `library.homeRows`** i ordning som `Shelf` (`kind==='issues'` → `IssueCard` med `showSeries`, `kind==='series'` → `SeriesCard` med `note`; `href`→"Visa alla"), därefter "Förlag"-shelf (`PublisherTile`, topp 12 efter antal serier, "Visa alla" → `/publishers`) och genre-chips (topp 16, länkar `/library?genre=`). Varje kort i shelf får fast bredd via wrapper (`width: var(--shelf-card-w, 150px)`).

**Serie (`/series/[id]`)**: `library.getSeries(page.params.id)`; saknas → EmptyState "Serien finns inte" + länk till `/library`. Toppsektion med blur-backdrop; stort omslag (vänster; `Cover` av `coverIssueId`), info (höger): titel `.h1`, förlagschip (länk `/library?publisher=`), "2012 – pågår"/"1991–1995"/"År okänt", status, genrechips (länkar), skapare, beskrivning (clamp-4 + "Läs mer"), källa: "Källa: Wikipedia – ’matchedTitle’" + knapp "Fel match?" (→ `MetaPicker`), och "Hämta metadata" om `!series.matched`. Åtgärder: primär "Fortsätt läsa"/"Börja läsa"/"Läs om" (→ `/read/{nextIssueId}`; text efter `state`/`inProgressIssueId`), ♥ (`toggleFavorite`), `RatingStars`, "Markera som läst/oläst", meny (⋯) med "Hämta metadata igen", "Redigera uppgifter" (Sheet: namn, förlag, genrer kommaseparerat, beskrivning → `setSeriesMeta`), "Ta bort från biblioteket" (bekräfta i Sheet → `removeSeries` → `goto('/library')`). Framsteg: "3 av 12 lästa" + ProgressBar. **Nummerlista**: växla rutnät/lista, stigande/fallande; varje nummer: omslag, "#N"/titel, sidor, läs-status, framsteg, olänkad-ikon (`!isLinked`), `unsupported` → nedtonad med förklaring ("RAR/CBR stöds inte på den här enheten än" / "Krypterad"), snabbmeny: "Markera läst/oläst" (`markIssues`). Sist: "Liknande serier" (`similarSeries(series, library.series, 12)` → `Shelf` av `SeriesCard` med `note = why`). **MetaPicker** (`lib/components/MetaPicker.svelte`, props `{ open, series, onclose }`): Sheet med sökfält (förifyllt `series.issues[0].seriesName`), "Sök" → `searchMeta({...library.metaQuery(series), name: input})`, kandidatlista (titel, källa-badge, förlag, år, beskrivning 2 rader, träff-% av `score`), tryck → `library.applyCandidate(series.id, c)` + toast; laddnings- och tomt-/felläge.

**Inställningar**: kort-sektioner: *Bibliotek* (siffror, "Lägg till mapp", "Lägg till filer", "Prova demodata"), *Lagring* (toggle `persistFiles` – "Spara kopior i appen (offline)", användning/kvot-bar från `library.storage` formaterad i MB/GB, "Beständig lagring: ja/nej" + knapp `persistStorage()`, "Ta bort sparade kopior" (bekräfta) → `clearCopies()`, antal länkade/olänkade, förklaring när `!storage.opfs`: "Offline-lagring kräver säker anslutning (https) och stöds inte här – du får välja mappen igen efter omstart."), *Metadata* (toggle `autoMetadata`, "Hämta för alla serier nu" → `enrichMissing(true)` med framsteg från `metaJob` + "Avbryt", integritetstext: "Serienamn skickas till Wikipedia/Wikidata, AniList, Google Books och Open Library."), *Läsaren* (standardvärden → `updateReader`: anpassning Hela sidan/Bredd/Höjd, uppslag Auto/Enkel/Dubbel, riktning Auto/Vänster→höger/Höger→vänster, bakgrund svart/mörkgrå/sepia, tryckzoner, håll skärmen på, förladdning 1–5), *Utseende* (kortstorlek-slider 120–260), *Installera* (om `ui.installEvent`: knapp som kör `ui.installEvent.prompt()`; annars hjälptext "Android/Chrome: ⋮ → Lägg till på startskärmen"), *Rensa* (röd knapp "Rensa hela biblioteket" → bekräfta i Sheet → `clearAll()`), *Om* (version, länk till Wikipedia-källor).

**Läsare (`/read/[id]`)**: Helskärm (`position:fixed; inset:0`; bakgrund `settings.reader.background`), `touch-action:none`, `overscroll-behavior:none`, `user-select:none`. Flöde: `await library.init()` → `library.getIssue(id)` (saknas → EmptyState) → `await library.getFile(id)`; saknas fil → överlägg "Filen är inte länkad till den här sessionen" + "Välj mapp" (`library.pick('folder')` direkt i klick, därefter försök `getFile` igen) + "Tillbaka"; `issue.unsupported` → förklaring. Annars `openArchive(file)` (`$lib/archive`) → sidor. Startsida = `progress.completed ? 0 : progress.page` (klampad). Rendering: enkel/dubbel sida (`spread:auto` = dubbel när fönstret är liggande, `innerWidth > innerHeight*1.1`; omslag (sida 0) och breda sidor (`issue.wide` eller `naturalWidth > naturalHeight`) alltid ensamma), riktning (`auto` = `issue.rtl || series.rtl` → RTL; i RTL byts vänster/höger ordning och tryckzoner/swipe), anpassning `screen` (contain), `width`, `height` (scrollbar vid behov). Gester: tryckzoner vänster/höger 30 % = föregående/nästa (riktningsmedvetet), mitten 40 % = visa/dölj HUD; svep ≥ 50 px horisontellt = bläddra; dubbeltryck = zoom 2.5× vid tryckpunkten/återställ; nyp-zoom + dra-pan med två pekare (Pointer Events); vid zoom: ingen sidbläddring, drag = pan, mitt-tryck = HUD. Tangentbord: ←/→ (riktningsmedvetet), Space/PageDown nästa, PageUp/Shift+Space föregående, Home/End, Esc tillbaka till serien, F helskärm, M HUD. HUD (auto-döljs efter 3 s, halvtransparent blur): topp: ← tillbaka (`/series/{seriesId}`), "Serie #N · titel", "7 / 32", ⚙; botten: slider (riktningsmedveten) + föregående/nästa nummer-knappar + helskärmsknapp (om API finns). Inställnings-Sheet: anpassning, uppslag, riktning, bakgrund, tryckzoner, håll skärmen på (sparas via `library.updateReader`). Förladdning: objekt-URL:er för [aktuell−1 … aktuell+`preload`+1], `img.decode()` i förväg, `URL.revokeObjectURL` på övriga och vid `onDestroy`; ladda sidor via `archive.readPage(i)`. Framsteg: `library.saveProgress(id, index, pageCount)` vid sidbyte (och vid avslut). Sista sidan + "nästa" → slutkort: "Utläst!" + knapp "Nästa nummer: {serie #N+1}" (→ `/read/{nextId}`, `replaceState`) + "Till serien". Wake Lock (`navigator.wakeLock`) när `keepAwake`, återta vid `visibilitychange`; Fullscreen API-knapp. Bildfel → platshållare med "Försök igen". `src/lib/imageSupport.ts` ska skrivas om så AVIF/WebP-stöd upptäcks på riktigt (avkoda en liten AVIF-data-URI i `Image`, `onload`/`onerror`, cacha resultatet); visa liten varning i HUD om AVIF-sida inte kan visas.
