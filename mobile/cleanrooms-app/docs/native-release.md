# Selvstændig iOS-app og push

Appen kan bygges som en signeret Release-app med indbygget JavaScript. Den kræver hverken Expo Go, Metro eller en tændt udviklingscomputer. Login og synkronisering kræver fortsat adgang til virksomhedens HTTPS-API.

## Byg fra det rigtige checkout

Brug den gennemgåede kildeudgave i Git-repositoriet. Kør kommandoerne fra `mobile/cleanrooms-app`:

```sh
npm ci
npm test
npm run typecheck
npm run lint

export EXPO_PUBLIC_CLEANROOMS_AUTH_URL='https://app-api.example.com'
npm run release:preflight -- production
npm run build:testflight
```

Erstat eksempeladressen med det offentlige medarbejder-API. Variablen er offentlig appkonfiguration, ikke en hemmelighed. Den samme adresse skal være konfigureret i det valgte EAS-miljø (`preview` eller `production`), så lokal kontrol og cloud-build bruger samme server. `EXPO_PROJECT_ID` kan tilsidesætte det allerede tilknyttede projekt i `app.json`; brug kun den faktiske Expo-projekt-UUID.

Preflight afviser en manglende projektkobling, en ugyldig HTTPS-origin, et checkout uden Git-HEAD eller en app, hvis `app.json` ikke er sporet i det pågældende repository. Den kontrollerer også repository-rodens uploadudelukkelser. Den erstatter ikke kodegennemgang, tests eller kontrol af ændringer før upload.

EAS læser `.easignore` fra **Git-repositoriets rod**. I dette monorepo udelukker rodfilen backend, QA, genererede nativeprojekter, runtimefiler, lokale miljøfiler og signeringsmateriale. Appmappens egen fil er til et eventuelt fremtidigt selvstændigt app-repository. Undersøg uploadarkivet ved ændringer i filstruktur eller ignore-regler; en child-`.easignore` beskytter ikke monorepoets øvrige indhold.

## Profiler og signering

| Profil | Brug |
| --- | --- |
| `preview` | Intern iOS-distribution, Release uden udviklingsklient. Fysiske enheder skal være dækket af signeringens distributionstype. |
| `production` | Store-signeret Release, remote buildnummer med automatisk forøgelse. Klar til separat TestFlight-indsendelse. |
| `simulator` | Release til iOS-simulator, ikke en installerbar iPhone-udgave. |

`npm run build:preview` og `npm run build:testflight` kører preflight før EAS Build. Navnet `build:testflight` **bygger kun binæren**; det indsender den ikke og udgiver intet i App Store.

Den ansvarlige kontoejer gennemfører selv Expo-/Apple-login, tofaktorkoder, valg af Developer-team og eventuelle aftaler i sin egen terminal eller browser. Apple-signering kan klargøres med:

```sh
npx eas-cli@latest credentials:configure-build --platform ios --profile production
```

Push kræver desuden gyldig APNs-konfiguration for appen i EAS' credentials-manager. Signeringscertifikater, provisioning-profiler, APNs-nøgler og eventuelle server-pushtokens må ikke gemmes i Git eller indgå i appens miljøvariabler.

`APPLE_TEAM_ID` er valgfri konfiguration til et bestemt team, eksempelvis ved lokal automatisk signering. Den valideres som et team-ID på ti tegn; den erstatter hverken Apple-login, medlemskab eller provisioning.

Efter en vellykket cloud-build er TestFlight et separat trin. Kontrollér først App Store Connect-appregistrering, adgang, eksportoplysninger og testgruppe. Vælg derefter den konkrete build ved indsendelse:

```sh
BUILD_ID='indsæt-den-gennemgåede-builds-id'
npx eas-cli@latest submit --platform ios --profile production --id "$BUILD_ID"
```

Appkonfigurationens `ios.config.usesNonExemptEncryption: false` beskriver den nuværende klient: HTTPS gennem operativsystemet og systemets Keychain/SecureStore, uden egen kryptering af kommunikation. Vurder erklæringen igen, hvis en ny afhængighed eller funktion indfører anden kryptering. For ældre uploads uden denne metadata kan Apple kræve samme oplysning i App Store Connect, før intern test kan begynde. Se [Expos SecureStore-vejledning](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/) og [Apples eksportvejledning](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations).

Dette er pilotdistribution via TestFlight. En offentlig App Store-udgivelse kræver en særskilt beslutning og Apples review.

## Lokal Release-kontrol

`npm run ios:release` bygger lokalt i Release uden at starte Metro. Nativefiler genereres fra appkonfiguration og config-plugins; redigér ikke de genererede `ios/`- eller `android/`-projekter i hånden.

Kontrollér den resulterende `.app` med:

```sh
node scripts/verify-ios-release.cjs '/absolut/sti/CleanRooms.app'
```

Kontrollen kræver korrekt bundle-ID og buildversion, en ikke-tom indbygget `main.jsbundle`, gyldig kodesignatur, nødvendige formålstekster og den gennemgåede eksportmetadata. Den afviser desuden udviklingslauncher, generel HTTP-undtagelse og baggrunds-/Always-placering. Den beviser ikke login, GPS, pushlevering eller hele brugerflowet. Start også appen med Metro stoppet. En simulatorbuild skal signeres korrekt for blandt andet Keychain/SecureStore; en usigneret build er ikke en retvisende loginprøve.

App Store Connect kontrollerer også statiske API-referencer i biblioteker. Expo Location 57 indeholder CoreMotion-kode, så den genererede `Info.plist` skal have en ikke-tom `NSMotionUsageDescription`, selv om CleanRooms ikke kalder bevægelses-API’erne. En formålstekst giver ikke i sig selv tilladelse eller viser en systemprompt. Appen anmoder fortsat kun om placering ved indstempling og aktiverer hverken bevægelsesregistrering eller baggrundsplacering. Den første upload blev standset af Apples efterkontrol med fejl 90683; en vellykket EAS-upload skal derfor altid følges til Apples behandlingsstatus.

## Push på den indloggede konto

Serveren skal have migrationen for push, korrekt `EXPO_PROJECT_ID`, separat dispatchnøgle og providercredentials. Se backendens `docs/employee-push.md` for outbox, autorisation, retries og receipts. Webdelen beholder sin private adgang; medarbejderappen bruger det separate login-API.

Afprøv med en konto og telefon, som testeren selv kontrollerer:

1. Installér den signerede app, og log ind.
2. Åbn **Indstillinger → Notifikationer**, og tillad beskeder på telefonen.
3. Tryk **Send testbesked**, når registreringen er klar. Knappen kan kun bestille en generisk besked til den aktuelle konto/session/installation; den kan ikke vælge andre modtagere.
4. Sæt appen i baggrunden, og kontrollér faktisk modtagelse. Tryk på beskeden, og kontrollér, at appen åbner den kontoautoriserede destination.
5. Kontrollér også afvist OS-tilladelse, logout/kontoskift og en besked til en vagt eller samtale, som kontoen ikke længere har adgang til.

Gentagne testtryk opretter højst ét event pr. installation pr. minut. “Testbesked bestilt” betyder, at serveren har accepteret bestillingen, ikke at telefonen har modtaget den. Generiske låseskærmsbeskeder indeholder ikke vagttider, løn, chattekst eller kundeadresser. Indhold og destination hentes efter åbning med det aktuelle login.

Push er deaktiveret i Expo Go og webpreview. Indbakken fungerer fortsat uden tilladelse til push.

## Drift og dokumenteret status

Vellykkede serverændringer forsøger straks at behandle køen. GitHub-workflowet `push-dispatch.yml` vækker desuden eksisterende arbejde cirka hvert femte minut, når det er aktiveret med de nødvendige repositoryvariabler og den særskilte hemmelighed. GitHub-tidsplanen er en **pilotfallback**, ikke en garanteret cron eller leverings-SLA. Overvåg fejl, inaktivitet og backlog; erstat udløseren med en driftsmæssigt garanteret scheduler før krav om bestemte leveringstider.

En signeret iOS-simulator-Release er afprøvet med Metro stoppet. Mobile runtime-, konto- og pushregressioner samt native bundlekontrol er kørt. Den 9. november 2026 bekræftede brugeren på sin egen iPhone med TestFlight 1.0.0 (2), at en ny selvtest efter serverrettelsen blev modtaget, og at et tryk åbnede den rigtige beskedoversigt. Dette er brugerbekræftet fysisk afprøvning; agenten observerede ikke telefonen direkte. Cloud-build, indsendelse og providerkvitteringer er i sig selv ikke fysisk leveringsbevis. Den fysiske prøve dækker selvtesten; kategorispecifikke vagt- og chatforløb er dækket af de automatiske tests.

Den efterfølgende samlede pilotopdatering er bygget fra `17f6eb3` som **1.0.0 (3)**. Den 9. november kl. 20:15 UTC er EAS build og indsendelse gennemført; Apple bekræfter `VALID` og `IN_BETA_TESTING` uden fejl eller advarsler. Den signerede IPA, produktions-API-origin, APNs og fravær af debuggeradgang er kontrolleret. De nye flow er afprøvet i en dedikeret iPhone-simulator gennem de faktiske handlers; build 3 er endnu ikke afprøvet på en fysisk telefon. [Den samlede flowrapport](./IPHONE-FLOW-2026-11-09.md) skelner mellem dette og brugerens tidligere fysiske pushprøve på build 2.

Primære vejledninger: [EAS Build](https://docs.expo.dev/build/introduction/), [EAS Submit](https://docs.expo.dev/submit/introduction/), [Expo push](https://docs.expo.dev/push-notifications/overview/).
