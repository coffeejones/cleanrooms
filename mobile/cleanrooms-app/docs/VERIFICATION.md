# Første appdemo — kontrol 4. november 2026

## Automatiske kontroller

- `npm test`: 17 domænetests bestået; kalender/lønperioder, nattevagter, begge sommertidsskift, pauser og klipning til intervaller, afsluttede timer/løn kontra prognose, anmodninger, rettigheder, tjeklister og gemte snapshots.
- `npx tsc --noEmit`: bestået.
- `npx expo lint --no-cache`: bestået uden fejl/advarsler.
- `npx expo-doctor`: 21/21 kontroller bestået.
- `npx expo export --platform ios --platform android --output-dir dist-native`: begge native JavaScript/Hermes-bundler bygget.

## Afprøvet i den fælles browserkode

Mobilbredder 360 og 390 pixels. Overblik og måneds-/ugekalender uden vandret scroll. Afsluttede og aktive vagter vises med deres respektive status. Vagtens kollegaer omfatter også en aftenvagt uden overlap med egen arbejdstid.

Afkrydsning pr. vagt, start/afslut pause, udstempling med kommentar, friønske, tilmelding til ledig vagt og den efterfølgende afventende status er afprøvet. Medarbejderen har ingen redigering af stemplingernes tidspunkter.

Lønperioder kan skiftes fremad. En fremtidig periode har nul optjening og et separat planlagt lønestimat. Selvvalgt interval er afprøvet med både ugyldig rækkefølge og en gyldig enkeltdag.

Chatbesked er afsendt lokalt og genfundet efter genindlæsning. Ulæst-status og notifikationslink til vagt fungerer. Notifikationsindstilling er ændret og genfundet efter genindlæsning. Demoen er bagefter genskabt gennem den eksplicitte nulstillingsbekræftelse, så den aktive vagt er klar til brugerens afprøvning.

## Resterende kontrol før udgivelse

Native bundling er ikke en fysisk enhedstest. Denne computer har kun Xcode Command Line Tools, ingen iPhone-simulator; Android-emulator er heller ikke tilgængelig. Afprøv især native faner, safe areas, tastatur, datovælger, skriftstørrelser, VoiceOver/TalkBack og baggrund/genåbning i Expo Go på iPhone og Android.

Dette er en lokal demo. Rigtigt login, servertilkobling, løngrupper og push er beskrevet i `MOBILE-BACKEND.md`. Den kendte Router-afhængighed er beskrevet i `DEPENDENCIES.md` og skal håndteres før en offentlig produktionsudgivelse.

## Kompakt overblik og opdatering ved udstempling

Home og Timer bruger den samme visning af afsluttet / planlagt løn og timer. Den præcise lønberegning kan foldes ud; oversigten viser afrundede kroner og decimaltimer. Nævneren følger den valgte periodes faktiske plan, også ved fremtidige og brugerdefinerede perioder.

Igangværende og pausede vagter bidrager ikke til periodetotalerne. Nye tests dækker urets fremrykning, gamle perioder med en fortsat åben registrering, øjeblikkelig tilføjelse ved udstempling, stabilitet efter udstempling, godkendelsesstatus, ejerskab, pauser, nattevagter og sommertid. Det aktive ur kan stadig ses i vagtdetaljen.

Browserprøve med særskilte lokale testdata: før udstempling 8.625 / 27.756 kr og 46 / 147,5 t; efter udstempling blev den afsluttede registrering tilføjet med det samme. Totalerne var bevaret efter genindlæsning. Brugernes eksisterende demodata på localhost blev bevaret.

## Seneste UI-iteration: åben hvid visning og én fremdriftslinje

Designet for denne iteration fjerner den farvede indramning omkring periodetallene og bruger den hvide sideflade. Både afsluttet / planlagt løn før skat og afsluttede / planlagte timer bevares. Der er kun én fælles fremdriftslinje, som afspejler timerne gennem `summary.progress`; lønforholdstallet har ikke sin egen linje.

Synlige demomærkater og demoforklaringer fjernes fra brugerfladen. Dette ændrer ingen datakilde, satser, rettigheder eller servertilkobling; de tekniske begrænsninger er fortsat dokumenteret i `MOBILE-BACKEND.md`.

Domænemodellen og dens 17 tests er uændrede i denne UI-iteration. Periodebeløb og timetotaler omfatter fortsat kun egne afsluttede registreringer med `clockOut` og status `submitted` eller `approved`. Åbne og pausede vagter tæller først efter udstempling. Urets fremrykning kan derfor ikke øge tallene eller fylde fremdriftslinjen.

Den nye udgave er kontrolleret i browseren på Home og Timer ved 390 pixels og på Home ved 360 pixels. Den synlige fremdriftslinje er optalt til præcis én på begge sider; forholdstallene er bevaret, og Home har ingen synlig demotekst eller vandret overflow. Lønberegningen er åbnet og lukket og viser præcise beløb som åbent indhold. Eksisterende gemte data er bevaret.

TypeScript og ESLint passerer uden fejl eller advarsler. Begge native bundler er eksporteret. Fremtidige og selvvalgte perioder blev afprøvet i den foregående iteration; for denne rent visuelle ændring er periodeberegningerne uændrede. Nul planlagte timer samt timer over planen er kontrolleret i kildekoden: linjen afgrænses til 0–100 %, og de faktiske forholdstal afkortes ikke.

VoiceOver/TalkBack skal kunne skelne lønforholdstallet fra timefremdriften. Fremdriftslinjens navn skal beskrive afsluttede timer i forhold til planlagte timer; en tom plan må ikke læses som en færdig periode. Den oprindelige kontrol af native enheder og hjælpemidler ovenfor er fortsat udestående.

## Compass-stil på mobil · 8. november 2026

Forside, Timer og vagtdetaljer deler nu webversionens petrolfarvede tekst, kølige neutrale flader og diskrete grønne handlinger/statusmarkeringer. Kalender, avatarer, periodekontroller og fælles kort følger de samme farver. Native faner og glass-effekter er bevaret. Den faste næste/aktive vagt på forsiden er fortsat adskilt fra ugens øvrige vagter.

Fælles knapper bruger native Expo UI med målt numerisk bredde og en afrundet, sammenhængende ydre ramme. Knaptekstens trykflade følger hele knappen. Manuel skrifttilpasning bruges kun på iOS, da Android og web allerede skalerer teksten. De mindste kontrolhøjder er fortsat 44/48 punkter.

Kontrolleret i den eksisterende iPhone 17 Pro-simulator på iOS 26.5 og i en separat simulator med lokale demodata: forside, lønperiode og fremtidig periode, kalendermåneder med pile, vagtdetalje, beskrivelse/tjekliste, åbning og annullering af udstempling samt knapper og indstillinger. Et tryk nær login-knappens venstre kant gav den forventede lokale feltvalidering. Ingen rigtig stempling eller kontoændring blev udført. Den oprindelige simulators login er bevaret.

`npm run typecheck`, `npm run lint` og alle 27 tests i `npm test` består. `npx expo export --platform all --output-dir dist-compass-ui` eksporterer iOS, Android og web. Android er ikke visuelt kontrolleret på en enhed i denne iteration. Skærmbilleder ligger i `outputs/compass-ui/`.

Dette er en UI-ændring. Eksisterende datakilder, adgangskontrol, GPS-validering, periodeberegninger og optjening ved udstempling er bevaret. Oplysninger om manglende Xcode/simulator tidligere i dette dokument beskriver de ældre iterationer; Xcode og simulatoren er nu installeret.

## GPS uden browserforbindelse · 8. november 2026

Den ældre GPS-pilot er fjernet fra indstillinger, indstempling, modeller og appens aktive browserintegration. Medarbejderen skal ikke forbinde et arbejdssted eller åbne den private webside. Rigtige konti bruger fortsat den autentificerede mobil-API: arbejdssted og aktuelle GPS-krav udledes af egen udgivne vagt, genlæses ved indstempling og håndhæves på serveren. En manglende eller ugyldig API-regel bliver en fejl i appen, aldrig en browserfallback.

Gamle gemte `workplacePolicyLink`-felter fjernes ved indlæsning uden at miste vagter, registreringer, pauser, tjeklistefremdrift eller lokale GPS-områder. Demoen bruger alene lokale GPS-områder. Tidligere callbacks fra browserpiloten ignoreres. Den gamle kryptografiske browserbro og dens særskilte tests er erstattet af tests af den faktiske native API-klient og datamigrationen.

`npm run typecheck`, `npm run lint` og alle 33 apptests består. De 7 nye API-tests dækker autentificering, ingen cookies/redirects, genlæsning af GPS-radius, eksplicit GPS-off, ugyldige svar, serverens stemplingskvittering samt fejl uden browserfallback. De eksisterende 42 relevante backendtests for mobilsessioner og tidsregistrering består også. iOS, Android og web er eksporteret med `npx expo export --platform all --output-dir dist-compass-ui`.

Indstillinger er kontrolleret visuelt i iPhone 17 Pro-simulatoren på iOS 26.5. GPS-forbindelsesknapperne og browservejledningen er væk; eksisterende vagter, registreringer og tjeklistefremdrift er bevaret. Skærmbillede: `outputs/compass-ui/settings-native.png`. Ingen rigtig konto, GPS-opsætning, stempling eller OS-placeringstilladelse blev ændret.

## Medarbejderdata gennem login · 8. november 2026

Timer, løn og Chat bruger nu den autentificerede mobil-API og de samme serverposter og beregningsregler som web. Kalenderens ledige vagter, friønsker, vagtbeskeder, kollegaer, tjeklistefremdrift og personlige indstillinger er også tilkoblet. Den eksplicitte lokale demo er adskilt; serverfejl skifter aldrig en rigtig konto til demodata.

Serveren afleder virksomhed og medarbejder af mobilsessionen. De relevante 84 backendtests består: sessioner og tilbagekaldelse, egne timer og historiske lønsnapshots, nattevagter og periodegrænser, chatmedlemskab, stabile besked-id'er og cursors, anmodninger, kollegaers minimale oplysninger, versioner og tjeklistens beskyttelse mod samtidig omfordeling. Alle 40 apptests består, inklusive de faktiske API-parsere samt chatvalidering og sammenfletning. TypeScript og ESLint består. iOS, Android og web er eksporteret; Android er ikke prøvet på fysisk enhed.

Den brede ældre webtestsuite har syv eksisterende fejl i `descriptions-integration`, `operations-integration` og `page-help`. Samme syv fejl er reproduceret på den uændrede HEAD-baseline før denne opdatering. En separat ældre `planner-point-cache`-test efterlod åbne handles under fuldkørslen; den fulde suite rapporteres derfor ikke som bestået. De målrettede 84 backendtests er afsluttet uden fejl.

Backend er udgivet i privat Studio-deployment `appgdep_6af0e204cf8c81918b82b20e7bb776e0` (commit `7fae5c78966f22df095687458c279b5483b11cd8`) og den eksisterende offentlige login-gateway i `appgdep_6af0e2296a108191832da108e01d0bbd` (commit `bcdf4933de619899010c9e3d41dc54e7e2f6a1ea`). Begge deploymentstatusser er `succeeded`; webdelens private adgang og eksisterende miljøhemmeligheder er bevaret.

Afprøvet med den eksisterende indloggede konto i iPhone 17 Pro / iOS 26.5: kalenderens egne udgivne vagter, vagtens kollegaer for hele dagen, Timer for lønperioden, den eksisterende webchat og gemt læsestatus samt egne vagtbeskeder. Kontoen viser fem vagter og 35 planlagte timer i 26. oktober–25. november, ingen afsluttede registreringer og ingen tilknyttet lønaftale. Derfor er optjening nul, og forventet løn står som manglende sats frem for demobeløb. Ingen rigtig besked blev sendt, og ingen stempling, lønaftale eller tilgængelighed blev ændret under UI-kontrollen. Skærmbilleder: `outputs/compass-ui/hours-connected-native.png` og `chat-connected-native.png`.

Native push via APNs/FCM kræver fortsat en særskilt integration. Kontoens personlige utilgængelighedsmarkeringer gemmes på serveren, men indgår endnu ikke i planlæggerens konfliktregler. Tilkoblingen er derfor ikke en påstand om, at disse to resterende funktioner er produktionsfærdige.

## Virksomhedens lønperiode og utilgængelighed · 8. november 2026

Den tidligere begrænsning om utilgængelighed er nu håndteret. Planlæggeren ser korte advarsler i ugekalender, vagtredigering, medarbejdervalg, afløservælger og seriepreview. Markeringen ændrer ikke eksisterende vagter. Serveren afviser en ny tildeling gennem tilbud, ledig vagt, accept eller godkendelse, hvis modtageren er utilgængelig. Oprettelse og godkendelse bruger præferenceversioner, også når en præferencepost først oprettes under transaktionen. Datoer for en nattevagt inkluderer den følgende dag, men slut ved præcis midnat inkluderer kun startdagen. Webudgivelsens eksisterende begrænsning til vagter med start før slut samme dag er ikke udvidet i denne iteration.

Virksomhedens indstillinger har en månedlig lønperiode med startdag 1–31. Dag 1 er kalendermåned; en startdag, som ikke findes i en kort måned, afkortes til månedens sidste dag. Preview viser den faktisk aktuelle periode. Manglende konfiguration bevarer 26.–25. Appen læser den autentificerede `employeeCompanySettings` ved åbning, fokus/genåbning og manuel opdatering af Timer. Et brugerdefineret datointerval bevares som brugerens eget valg. Fejl giver ingen lokal periodefallback. Historiske godkendte lønsnapshots ændres ikke.

Kontroller: 122 målrettede backendtests, 27 web-/cache-/indstillingstests og alle 43 apptests består. Desuden er appens og serverens periodegrænser sammenlignet for 11.160 kombinationer af dato, startdag og periodeoffset i normale år og skudår; alle giver samme resultat. TypeScript, ESLint i appen samt iOS-, Android- og webeksport består. Den brede ældre websuite er ikke genkørt; dens tidligere dokumenterede baselinefejl er ikke rapporteret som løst.

I den isolerede lokale browserfixture er kalendermåned, startdag 31, det korrekte korte-måneder-preview og gemmekvitteringen afprøvet med hukommelsesdata. Den private produktion viser indstillingen under Indstillinger → Virksomhed → Lønperiode. Den eksisterende indloggede iPhone 17 Pro / iOS 26.5 henter lønperioden og de egne timer gennem den nye serverhandling. Den rigtige virksomheds lønperiode, medarbejderes tilgængelighed og stemplinger er ikke ændret under UI-kontrollen.

Udgivet backend: commit `7fd137ff638b615a843d80d629a181bbbfcde41f`, deployment `appgdep_6af0ebe964748191bfe6d0105b97a4c9`, status `succeeded`. Webadgang og miljøkonfiguration er bevaret. Webskærmbillede: `qa/company-payroll-period-live.png` i det fælles projekts rod. Appens næste lønperiode er også kontrolleret: 26. november–25. december viser de fire egne vagter med 28 planlagte timer; tilbagevenden viser igen fem vagter og 35 timer. Native skærmbillede: `outputs/compass-ui/company-period-native.png`. Native push er fortsat en separat integration.

## Mobilstabilisering 9. november 2026

- `npm test`: 57/57 bestået med faktiske kompilerede modeller/API-adaptere. Nye regressioner dækker serverbaseret monoton varighed ved skævt vægur, aktiv/overnight-vagt uden periode, timeout efter servercommit uden ny skrivning, uafklaret resultat, bevaret 409/401, returneret tidskommentar uden klokkeredigering, Retry-After/jitter og forældet succes, malformed native links samt logoutkøens offline/restart, serialiserede samtidige jobs/ACK samt origin-/konto-/lager-/udløbsforløb.
- `npm run typecheck` og `npm run lint`: bestået.
- `npx expo install --check`: ingen forældede inkompatible pakker efter Expo57-patchopdatering.
- Native iOS-simulatorbuild via Xcode workspace, Debug, signing deaktiveret: `BUILD SUCCEEDED` (arm64/x86_64). Ingen Swift-filer ændret manuelt.
- iOS/Hermes-export er gennemført, også efter JS-ændringerne.
- Disse checks er model-/adaptertests og native build/bundling. Der er ikke gennemført en ny UI-test på fysisk iPhone/Android eller et live end-to-end-forløb mod de nye backendactions i denne iteration. Kø-/callback-tests er isolerede og bruger syntetiske tokens, aldrig driftssessioner.
