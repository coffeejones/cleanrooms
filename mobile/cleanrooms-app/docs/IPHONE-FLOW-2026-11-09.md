# Mobil sikkerhed og iPhone-flow · 9. november 2026

Brugerfladen er bevaret. Afprøvningen er udført i officiel Expo Go 57.0.9 på en ny iPhone 17 Pro-simulator med iOS 26.5. Der er brugt en separat loopback-API med de rigtige Workspace-, gateway-, mobil-, tids- og lønhandlers, alle migrationer og egne syntetiske konti. Produktionskonti og produktionsstemplinger er ikke brugt eller ændret.

## Rettelser

- De 15 resterende dependencyfund er lukket med rettede officielle pakker og en verificeret CommonJS-entry til decoderens uændrede upstreamalgoritme. Fuld og omit-dev audit: 0. Se [DEPENDENCIES.md](DEPENDENCIES.md).
- Native Core Location returnerer undertiden brøkdele af millisekunder. Appen normaliserer nu det oprindeligt målte tidspunkt til hele millisekunder efter friskhedskontrollen; den erstatter aldrig måletid med et nyt tidspunkt. Det løste en reel iOS-indstempling, som tidligere fik HTTP 400.
- En frosset nattevagt 22–06 kan genfindes og afsluttes efter aflysning, også uden for den viste kalenderuge. Ejerskab og ugyldige data kontrolleres fortsat.
- En kvitteret stempling udløser kun én invalidering af timer. Live-vagtdetaljer bevarer det eksisterende før/efter-ikon, og friønsker genlæser gemt status og begrundelse ved genåbning.

## Observeret gennem telefonens UI

| Trin | Resultat |
| --- | --- |
| Nyt medarbejderlogin | Egne udgivne vagter vises uden tvunget kodeændring eller browser. |
| Beskrivelse og tjekliste | Kollega vises; ét punkt ændres fra 0/3 til 1/3 og består ved genåbning. |
| GPS uden for 200 m | Afvist med konkret afstandsbesked; ingen registrering oprettes. |
| GPS ved arbejdssted | Indstempling bekræftes med serverkvittering. |
| Pause og tvungen app-lukning | Login og paused registrering genfindes; 20 minutters arbejdstid gendannes fra serveren. |
| Genoptag og udstempling med kommentar | Kommentar sendes; medarbejderen får ingen mulighed for at redigere klokkeslæt. |
| Tabt finish-svar efter commit | Test-API returnerer 503 efter faktisk gemning. Appen genlæser kvitteringen og viser succes uden endnu en finish-write. |
| Returnér → forklar → genindsend | Planlæggerens begrundelse vises. Medarbejderens forklaring tilføjes uden at ændre de oprindelige stemplingstidspunkter. |
| Godkendelse og løngruppe | 56 nettominutter, 6 minutters faktisk pause; 168,00 kr. grundløn + 11,20 kr. tillæg = 179,20 kr. vises som godkendt i appen. |
| Personlig satsændring efter godkendelse | Tidligere godkendt løn forbliver 179,20 kr. og oprindelig gruppeversion bevares. |
| Ændret kommende vagt | Besked åbner vagten; gammelt 12:21–13:21 og nyt 13:21–14:21 vises i den eksisterende ændringsdialog. Læsestatus gemmes. |
| Friønske | Afventer-status består efter luk/genåbn, og normal gensendelse er fjernet. |
| Chat | Rigtige beskeder læses, sendes og modtages uden manuel genindlæsning. |
| Arbejdssted uden GPS | Indstempling lykkes efter fjernet simulatorplacering, uden GPS-dialog; efterfølgende udstempling lykkes. |

Den primære registrering har én start, pause, resume, finish, reject, comment og approve i auditsporet; version 7 efter godkendelse. Oprindelige UTC-stemplinger er uændrede gennem returflowet. De præcise minutter inkluderer den tid, UI-testen faktisk tog; der er ikke fabrikeret en lønkvittering.

## Gentagelig kontrol

- Web: lint, typecheck og 1.828 tests i 155 testfiler består. Første parallelle kørsel havde én proces-timeout under samtidig kold Metro-bundling; filen bestod særskilt, og den fulde efterfølgende kontrol bestod uden fejl eller skips.
- Mobil: 77 tests, typecheck, lint, ren npm ci/postinstall og Expo 57-kompatibilitet består.
- iOS og Android: Hermes-export samt kontrol af den præcise decoderkilde i begge sourcemaps består.
- Separat HTTP-smoke gentager udgivelse, indbakke uden for kalenderperioden, GPS, checkliste, aktiv registrering, pause, tabt kvittering/CAS, retur, godkendelse, frosset løn, chat og API-udfald. Den ændrer ikke telefonfixturen.

Kør den isolerede flowtest fra repository-roden:

```sh
node qa/iphone-flow/smoke.mjs
```

[QA-vejledning](../../../qa/iphone-flow/README.md) beskriver den manuelle telefonrunde. Credentials, sessioner og databaser ligger kun i ignorerede runtime-mapper. CI gentager smoke, tests, audit og begge native bundlekontroller.

## Afgrænsning

Dette er en rigtig native simulatorafprøvning, ikke en fysisk iPhone-test. GPS-koordinaterne er simulerede; antennenøjagtighed, baggrundsforløb og netværk på en fysisk telefon mangler stadig praktisk afprøvning. Android er bygget og valideret, men ikke betjent på en fysisk telefon. Det lokale API-udfald simulerer HTTP 503, ikke flytilstand. Der er ikke ændret på produktionsadgang, GPS-regler eller brugernes data for at få testene til at bestå.
