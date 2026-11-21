# Idéer för rekommendationer och upptäckter

## Förslag att bygga vidare på

- **Mer från en skapare:** utgå från författare eller illustratörer som lästs eller fått högt betyg. Visa andra serier i biblioteket och länka till skaparens profil.
- **Karaktärens bästa:** visa lästa och olästa nummer med en vald karaktär, sorterade med tydlig uppgift om var betyg kommer ifrån. Utan tillförlitliga betyg ska raden inte kallas ”bästa”.
- **Vad hände sedan?** Visa vad en författare eller illustratör arbetade med före eller efter en serie, eller nästa framträdande för en karaktär. Nummer och datum behöver komma från en källa som täcker mer än biblioteket.
- **Eisnerpriset:** visa nominerade och vinnare med år, kategori och verifierad källa.
- **Topprankat per år eller årtionde:** ange betygskälla, antal röster och urval, så att små urval inte ser ut som en allmän topplista.
- **Legendariska serier:** bygg redaktionella eller källbelagda listor och visa varför en serie ingår, inte bara en odefinierad poäng.

## Önskelista och externa nummer

Låt användaren spara serier och nummer som saknas lokalt till en önskelista. Spara källans stabila ID, titel, nummer, utgivningsår, källa och länk; håll önskelistan separat från importerade filer. När en matchande fil läggs till bör appen föreslå en koppling och låta användaren bekräfta den.

Önskelistan och sparade externa metadata bör följa med i appens versionsmärkta JSON-backup. Ingen bakgrundshämtning får tyst skriva över ComicInfo eller användarens egna ändringar. Hämta och cacha metadata med källhänvisning, respektera API-begränsningar och hantera ändrade eller saknade verk utan att gissa.

## Databegränsningar

Lokala rekommendationer kan byggas direkt från bibliotek, läshistorik, betyg och karaktärer i ComicInfo/Metron. Rekommendationer utanför biblioteket kräver tillförlitlig, tillåten katalogdata samt stöd för paginering och källhänvisning. Skilj användarens betyg från externa betyg. Hjälte/skurk ska bara visas om en verifierbar källa faktiskt anger klassificeringen.
