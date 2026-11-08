# CleanRooms Studio — medarbejderapp

En native Expo / React Native-demo til iPhone og Android. Den eksisterende webapp til planlæggere ændres ikke af dette projekt.

## Start

Kræver Node.js og npm. Brug en aktiv Node LTS-version til den normale udviklingsopsætning.

```sh
npm install
npm start
```

Åbn QR-koden med [Expo Go](https://expo.dev/go) på en telefon på samme netværk. På iPhone kan kameraet åbne koden. Projektet bruger Expo SDK 57.

## iPhone-simulator i Xcode

Installer [Xcode](https://apps.apple.com/dk/app/xcode/id497799835) (26.4 eller nyere), åbn det én gang, og installer iOS under **Xcode → Settings → Components**. Kør derefter fra appmappen:

```sh
npm run ios
```

Kommandoen bygger CleanRooms lokalt, starter iPhone-simulatoren og åbner appen. Til arbejde direkte i Xcode skal du åbne `ios/CleanRooms.xcworkspace`, vælge en iPhone-simulator og trykke **Run**. Start i så fald Expo med `npx expo start --localhost --port 8081` i en terminal. Hvis iOS-mappen endnu ikke findes, opretter `npm run ios` den.

Hvis macOS stadig peger på Command Line Tools, kan du vælge Xcode for den enkelte kørsel med `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npm run ios`.

## Medarbejderlogin

Denne offentlige kildeudgave har ingen forudvalgt produktionsserver. Opret `.env` ud fra `.env.example`, sæt `EXPO_PUBLIC_CLEANROOMS_AUTH_URL` til dit eget login-API, og genstart Expo. En lokal udviklingsbuild kan bruge en loopback-adresse med port, f.eks. `http://127.0.0.1:4179` i iPhone-simulatoren eller `http://10.0.2.2:4179` i Android-emulatoren. Vælg **Prøv demoen** på loginskærmen for at åbne den lokale demo.

Login, udgivne vagter, indstempling og GPS-krav bruger API'et direkte i appen. Arbejdsstedet udledes af vagten og den indloggede medarbejder; der er ingen manuel forbindelse til web og intet browservindue. Administratorens GPS-opsætning bliver på web. Den lokale demo er separat og bruger lokale GPS-områder.

## Browserpreview

```sh
npm run web
```

Browseren er et preview af den fælles appkode. iOS har native faner og systemkontroller; Android bruger sine tilsvarende kontroller. Test derfor også på rigtige telefoner før udgivelse.

## Afprøv demoen

- **Overblik:** ugens vagter med ugenummer og ugeskift samt en fast næste eller aktiv vagt nederst.
- **Kalender:** egne vagter og ledige vagter; åbn en vagt for dagens kollegaer, beskrivelse, tjekliste og anmodninger.
- **Timer:** indtjening før skat som demoestimat, arbejdstimer og planlagte timer. Skift lønperiode eller vælg et datointerval, også i fremtiden.
- **Chat:** afdelingernes samtaler, ulæste beskeder og afsendelse.
- **Notifikationer og indstillinger:** læs beskeder, åbn den tilknyttede vagt eller samtale, og gem notifikationsvalg.

Demodata og ændringer gemmes lokalt via AsyncStorage. Demouret starter kl. 10.24 på oprettelsesdagen, så en igangværende vagt kan prøves uanset det faktiske klokkeslæt. Stemplinger oprettes med demouret; medarbejderen kan kommentere udstemplingen, men ikke ændre tidsstemplerne. Fri- og vagtanmodninger venter på planlæggerens godkendelse og ændrer ikke selv vagtplanen.

Time- og løntotaler omfatter kun udstemplede vagter, også mens timerne afventer godkendelse. De vises som afsluttet / planlagt for den valgte periode med én fælles fremdriftslinje baseret på afsluttede timer. Igangværende og pausede vagter påvirker ikke totalerne; selve vagtdetaljen kan stadig vise det aktive ur.

Tjeklistefremdrift gemmes pr. vagt. Indstillinger → Genskab startdata genskaber startdata efter en bekræftelse.

**Demoen er ikke forbundet til en virksomhedskonto.** Beskeder sendes ikke til andre telefoner, løn er ikke en lønseddel, og pushbeskeder er ikke tilkoblet endnu. Brug ikke rigtige person-, løn- eller kundedata i denne lokale demo. Se [backendplanen](docs/MOBILE-BACKEND.md) for den konkrete tilkobling.

## Kontrol

```sh
npx tsc --noEmit
npx expo lint
npm test
npx expo-doctor
```

SDK-kompatible pakker tilføjes med `npx expo install <pakke>`. Routes ligger i `src/app`, skærme i `src/screens`, domænemodeller i `src/domain` og demostore/handlinger i `src/state`.
