# CleanRooms

Vagtplanlægning på web og en medarbejderapp til iPhone og Android.

Projektet omfatter vagtserier, afdelinger og arbejdssteder, tidsregistrering og godkendelse, løngrupper og tillæg, fravær, tilgængelighed, vagtanmodninger, tjeklister og afdelingschat.

| Del | Mappe | Teknologi |
| --- | --- | --- |
| Planlæggerens webapp og backend | [sites/cleanrooms-studio](sites/cleanrooms-studio) | Vinext, Cloudflare Workers og D1 |
| Medarbejderapp | [mobile/cleanrooms-app](mobile/cleanrooms-app) | Expo 57, React Native og TypeScript |
| Separat login-API til mobil | [sites/cleanrooms-app-api](sites/cleanrooms-app-api) | Cloudflare Worker |

## Kom i gang

Brug Node.js 22.18 eller nyere, npm og Python 3. Installation køres separat i de to appmapper; de bruger forskellige React-versioner og deler ikke `node_modules`.

```sh
cd sites/cleanrooms-studio
npm ci
npm run dev
```

```sh
cd mobile/cleanrooms-app
npm ci
npm start
```

Vælg **Prøv demoen** for at afprøve appen med lokale eksempeldata. Medarbejderlogin bruger dit eget API, som konfigureres i appens `.env` ud fra [eksempelkonfigurationen](mobile/cleanrooms-app/.env.example). `EXPO_PUBLIC_`-værdier er offentlige appindstillinger og må ikke indeholde adgangsnøgler.

## Hosting og data

Webbackendens identitet bygger på Sites' autentificerede brugerheaders. D1 indeholder virksomhedernes versionerede poster; schema og migrationsfiler ligger i webprojektets `db/` og `drizzle/`. Lokal loginunderstøttelse er kun til udvikling på loopback.

Hostingmanifesternes bindinger er bevaret, mens den eksisterende installations projekt-id'er er fjernet. En ny Sites-udgivelse skal knyttes til sit eget projekt. Gatewayen kræver din egen `STUDIO_ORIGIN` samt serverhemmelighederne beskrevet i [gatewayens README](sites/cleanrooms-app-api/README.md).

Repoet indeholder kildekode, testfixtures og migrationsfiler. Det indeholder ingen driftsdatabase, brugeradgange, private hostingnøgler, enhedsdata eller lokale skærmbilleder. Navne, adresser og lønsatser i demo-fixtures er eksempeldata.

## Kontrol

Web/backend og de gennemgående applikationstests:

```sh
cd sites/cleanrooms-studio
npm ci
npm run verify
npm run build
```

Kør fra dette komplette monorepo: gennemgangstesten bruger også gatewayens rigtige worker i `sites/cleanrooms-app-api`.

Medarbejderapp:

```sh
cd mobile/cleanrooms-app
npm ci
npm test
npm run typecheck
npm run lint
```

GitHub Actions kører begge kontroller med låste afhængigheder. De tidligere kendte røde webtests og hængende kontrol er gennemgået; processer med åbne handles eller annullerede tests gør nu kontrollen rød.

Læs [stabiliseringsnoterne](sites/cleanrooms-studio/docs/stabilisation-2026-11-09.md) for rettelser og præcise afgrænsninger. [Mobilens afhængighedsrapport](mobile/cleanrooms-app/docs/DEPENDENCIES.md) beskriver resterende advisories, som ikke er skjult med inkompatible opgraderinger. Native push og afdelingsafgrænsede planlæggerrettigheder er implementeret. En hostingbaseret gendannelsesøvelse er fortsat særskilt arbejde.

Se også [arkitektur](sites/cleanrooms-studio/docs/architecture.md), [drift](sites/cleanrooms-studio/docs/operations.md) og [mobilens datatilkobling](mobile/cleanrooms-app/docs/MOBILE-BACKEND.md).
