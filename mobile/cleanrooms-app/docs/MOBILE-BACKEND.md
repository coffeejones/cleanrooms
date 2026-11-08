# Fra lokal demo til tilkoblet medarbejderapp

Appen har et autentificeret datalag i `src/auth/mobile-auth.tsx` og `src/state/published-schedule.ts` til rigtige konti, udgivne vagter, arbejdsstedets GPS-krav og tidsregistrering. Den separate lokale demo bruger `src/state/app-store.tsx`. Rene modeller, datoer og lønberegninger ligger i `src/domain`; demoovergange ligger i `src/state/transitions.ts`.

Medarbejderen bliver i appen. Et login opretter en sikker mobilsession; appen henter egne udgivne vagter og arbejdsstedets aktuelle GPS-krav direkte gennem login-API'et. Vagten og reglen genlæses ved indstempling. Telefonens placering bruges kun, hvis GPS er påkrævet; serveren kontrollerer selv arbejdssted, afstand, præcision og tidspunkt. Et mislykket API-kald vises som en fejl i appen og åbner aldrig en browser. Den private webdel bruges kun af administratoren til opsætning.

Den tidligere browserbaserede GPS-pilot er fjernet. Den lokale demo bruger sine egne GPS-områder og kræver ingen webforbindelse. Gamle gemte browserforbindelser fjernes ved indlæsning, mens vagter, stemplinger, pauser, tjeklistefremdrift og lokale GPS-områder bevares.

## Det eksisterende backend kan genbruge

Webprojektet ligger under `sites/cleanrooms-studio`. Dets medarbejderrettigheder og serverregler er udgangspunktet:

| Område | Eksisterende handlinger / regler |
| --- | --- |
| Vagter og tjeklister | `employeeRead`, `employeeShift`; afgrænsning til den indloggede medarbejder. |
| Stempling | `timeRead`, `timeWrite`; serveren bestemmer klokkeslæt. Medarbejderen kan kommentere, men ikke redigere stemplinger. |
| Anmodninger og beskeder | `workflowRead`, `workflowRequest`, `readMessage`; planlæggergodkendelse og kontrol af overlap/fravær. |
| Fravær | `leaveCreate` med person udledt fra medlemskab; godkendelsesflow bevares. |
| Chat | Medlemskontrolleret liste/læsning/afsendelse og begrænset `chatSync` med cursor. |

Genbrug beregningsregler fra `src/timekeeping-model.js`, `src/payroll-model.js`, `src/payroll-groups-model.js` og kalenderintervaller fra `src/employee-calendar.js` gennem en fælles, platformuafhængig kontrakt. Importér ikke webvisninger eller browserbroen i mobilappen.

## Tilkoblede medarbejderfunktioner

- Timer henter kun egne udgivne vagter og tidsregistreringer for den valgte periode. Standardperioden følger virksomhedens `workspaceSettings.payrollPeriod.startDay` (1–31), læst gennem den sessionsafgrænsede `employeeCompanySettings`. Startdag 1 er en kalendermåned; korte måneder bruger den sidste dag som start. En virksomhed uden indstillingen bevarer 26.–25. Ugyldige svar bliver en fejl, aldrig en lokal standard. Løn beregnes på serveren med webversionens løngrupper, daterede satser, personlige undtagelser og historiske godkendte lønsnapshots. Månedsløn og månedlige tillæg vises særskilt. Manglende satser og beløb, som ikke sikkert kan fordeles over en periodegrænse, markeres eksplicit.
- Chat deler afdelingernes rum, beskeder, fastgjorte beskeder, læsestatus og lydløsvalg med webversionen. Medlemskab og aktiv mobilsession kontrolleres ved hver læsning og skrivning. Beskeder bruger et stabilt klient-id ved genforsøg; nye beskeder hentes med en sekvensmarkør, og polling stopper uden for den aktive skærm eller i baggrunden.
- Notifikationer i appen viser egne vagtændringer og anmodninger med fælles læsekvitteringer. Ledige vagter og friønsker bruger de samme afventende anmodninger og godkendelsesregler som web.
- Tjeklister gemmes på den konkrete udgivne vagt i de samme tabeller som web. Et tjeklistetoken og en transaktionskontrol af vagtens version, ejer og indhold beskytter mod samtidige ændringer.
- Kollegaer hentes som paginerede, minimale oplysninger om hele dagen på det samme arbejdssted. Løn, private kontaktoplysninger og fraværsårsager medsendes ikke.
- Notifikationsvalg og utilgængelige datoer gemmes pr. virksomhed og medarbejder med postversioner. Planlæggeren henter kun valgte medarbejderes utilgængelige datoer for korte perioder gennem `planningAvailability`. Markeringerne giver advarsler i planlægningen og aflyser ikke eksisterende vagter. Nye tilbud, tilmeldinger til ledige vagter, accept og godkendelse kontrollerer modtagerens aktuelle tilgængelighed. Den samme transaktion afviser også en samtidig første oprettelse eller ændring af tilgængelighed. Nat og præcis midnat håndteres som faktisk berørte kalenderdage.

Native push via APNs/FCM og enhedsregistrering er en separat integration. Indstillingerne gemmes allerede på kontoen; denne iteration opretter ikke push-abonnementer. Den lokale demo åbnes kun gennem det eksplicitte demovalg og bruges aldrig som fallback for en rigtig konto.

## Regler ved tilkobling

- Serveren autoriserer hver handling og afleder medarbejderen fra sessionen. En klientoplyst `personId` giver ingen rettigheder.
- Hent data efter synligt dato-/løninterval og chatcursor, og afgræns virksomhed og afdeling på serveren. Hent vagtens lange beskrivelse og tjekliste ved åbning.
- Send mutations-id og den relevante postversion. Genforsøg må ikke skabe to stemplinger, beskeder eller anmodninger; konflikter skal give et konkret svar og opdaterede data.
- Stempling bruger serverens tid. Appen må aldrig vise en offline handling som godkendt eller registreret på serveren, før den er bekræftet.
- En ansøgning om fri eller en ledig vagt er en anmodning. Kontroller overlap, fravær og rettigheder igen i godkendelsens transaktion.
- Tjeklister gemmes på den konkrete vagt, også når vagten stammer fra en serie.
- Opdel cache efter konto og virksomhed, og slet den ved logout. Den nuværende AsyncStorage-demo indeholder ingen autentificeringshemmeligheder og skal ikke genbruges som sikker løn- eller sessionslager.
- Indlæs notifikationer og chat med stabile id'er/cursors. Modtag nye hændelser uden at udskifte hele listen eller flytte læserens scrollposition.

Demoens satser og enkle tillægsregler er kun til afprøvning af brugerfladen. De erstatter ikke virksomhedens faktiske løngrupper, personlige undtagelser, lønperiodeopsætning eller overenskomstregler.
