# Afhængigheder og sikkerhedsrettelser

Kontrolleret 9. november 2026. Mobilappen bliver på Expo SDK 57 og den eksisterende brugerflade. Både fuld `npm audit --package-lock-only --ignore-scripts` og samme audit med `--omit=dev` giver **0 sårbarheder** efter rettelserne. Ingen advisory er ignoreret, og ingen version er ommærket for at skjule et fund.

## Rettede afhængigheder

| Kæde | Installeret rettelse | Kompatibilitet |
| --- | --- | --- |
| Router 57 → query-string 7 → decode-uri-component | Officiel `0.5.1`, med kontrolleret CommonJS-entry | Query-string beholder sin kaldbare `require()`-eksport; ESM-entry og selve upstreamalgoritmen er uændrede. |
| Expo fingerprint → glob | Officiel `14.0.4` | Fingerprints faktiske `glob()`-kald, discovery, ignorevalg og AbortSignal testes. |
| Fingerprint / TypeScript ESLint → minimatch | Officiel `11.0.5` for de berørte 7–10-versioner | De faktiske forbrugere bruger `minimatch()`/`Minimatch.pattern`/`negate`/`match`, som er bevaret. Gamle sikre 3.x-forbrugere ændres ikke. |
| ESLint React hooks → zod/v4 | Officiel `4.6.7` via normalt understøttet semverinterval | Pluginet tillader allerede zod 4 og importerer `zod/v4`. Fejlformatter og lint testes; ingen global zod-override. |

Glob14/minimatch11 fjerner visse interne/ældre API'er, bl.a. `makeRe()`. De API'er bruges ikke af de berørte installerede forbrugere; denne vurdering erstatter ikke test ved senere opdateringer. Expo CLI's versionskontrol er fortsat grøn. Der er ikke brugt `npm audit fix --force` eller foretaget en større Expo-opgradering.

## Decoderens CJS-adapter og forsyningskæde

`query-string@7.1.3` kræver en funktion direkte fra `require('decode-uri-component')`. Den rettede upstream 0.5.1 er ESM, hvis rå namespace derfor ikke opfylder dette API. `scripts/dependency-security.cjs` gør følgende ved **hver normal npm ci/npm install**:

1. Kontrollerer lockfilens registry-SHA512 mod `vendor/decode-uri-component/UPSTREAM.json`.
2. Kontrollerer SHA256 af den officielle `index.js` og MIT-licensen. Registry-integriteten, kildehash, original pakkemetadata og licensen ligger til kildegennemgang i `vendor/decode-uri-component/`.
3. Genererer `index.cjs` ved kun at omskrive `export default function` til `module.exports = function`. Der ændres ikke i afkodningsalgoritmen.
4. Tilføjer en betinget `require`-entry; eksisterende ESM-/type-entry bevares.
5. Kontrollerer de reelle dependency-opslag hos query-string, fingerprint, TypeScript ESLint og React hooks, så en gammel nested dependency ikke kan skygge for den sikre lockfil.

Den officielle MIT-licens er bevaret både i den installerede pakke og i den checkede kilde. Der er ingen netværksdownload i postinstall-scriptet og ingen adgang til credentials.

`npm run check:dependencies` afviser ændret kilde, licens, metadata eller manglende adapter. `npm test` kører dette som pretest; Metro kører det også før bundling. En installation med `--ignore-scripts` kan derfor ikke stiltiende bygge den forkerte modulkontrakt. Efter en eksplicit gennemgang af install-scriptet kan adapteren installeres med `npm run postinstall`.

## Regressioner og native kontrol

`tests/dependency-security.test.cjs` ligger i den almindelige testsuite og kontrollerer:

- CJS- og officiel ESM-adfærd mod 500 deterministiske malformed inputs, dansk Unicode, emoji, BOM og afbrudt UTF-8.
- Query-string-array-/plus-/null-semantik og prototypefri dictionaries.
- De faktiske Expo Router-serializers med Unicode-vagtlinks. Kun native platformvalg/container-validering stubbes i Node; parserne og afhængighederne er de rigtige.
- Store fejlformede inputs i en separat proces med håndhævet timeout.
- Fingerprints reelle matching-/globkontrakter og annullering, samt zod/v4's tidlige afvisning af 50.000 elementer med ét begrænset fejlobjekt.
- Fail-closed-kontrollen ved ændret upstreamkode, ændret adapter eller genoprettet ESM-only metadata.

Ren `npm ci` med postinstall er gennemført. iOS og Android er begge bundlet til Hermes gennem Metro. Sourcemaps på **begge** platforme indeholder nøjagtigt den verificerede `decode-uri-component/index.cjs`; hverken den gamle decoder eller en forkert ESM-entry bliver valgt. Dette kan gentages med:

```sh
npm ci
npm test
npm run typecheck
npm run lint
npx expo install --check
npx expo export --platform ios --platform android --source-maps --output-dir dist-dependency-security
npm run verify:native-dependencies
npm audit --package-lock-only --ignore-scripts
npm audit --package-lock-only --ignore-scripts --omit=dev
```

Build og isolerede regressioner er ikke det samme som en fuld fysisk Android-test. Fremtidige SDK-/pakkeændringer skal genkøre kompatibilitet, routing, installintegritet og native bundlekontrol.

## Primære kilder

- [Decoderens officielle 0.5.1-kilde](https://github.com/SamVerschueren/decode-uri-component/tree/v0.5.1), [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), [GHSA-qr28-fpjm-wq7f](https://github.com/advisories/GHSA-qr28-fpjm-wq7f).
- [Glob changelog](https://github.com/isaacs/node-glob/blob/main/changelog.md), [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4).
- [Minimatch changelog](https://github.com/isaacs/minimatch/blob/main/changelog.md), [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
- [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), pluginets installerede dependency-/importkontrakter.
- [Expo57 dokumentation](https://docs.expo.dev/versions/v57.0.0/), [Expos Metro-konfiguration](https://docs.expo.dev/guides/customizing-metro/).
