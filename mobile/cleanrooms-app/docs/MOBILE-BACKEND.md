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

## Stabiliserede medarbejderflows

- `employeeInbox(cursor, limit)` og `employeeInboxRead(messageId)` er uafhængige af vagtens dato og kalenderens valgte periode. Indbakke og klokke deler invalidering; ekstra sider er bundet til en konkret frisk generation.
- `employeeActiveTime()` gendanner egen igangværende/pause-registrering uanset valgt uge og app-genstart. Uret viser serverens varighed plus monoton tid siden modtagelse, aldrig forskellen mellem server- og telefonens vægur.
- Et usikkert stemplingsresultat genlæser den konkrete vagt og bekræfter overgang/version før succes eller fejlsvar. Et fortsat ukendt resultat vises som uafklaret; et nyt forsøg genlæser igen og genbruger CAS, uden automatisk dobbeltstempling.
- Returnerede timer viser planlæggerens begrundelse og medarbejderens kommentar. `shiftTime.submit` sender kun forklaring/version, aldrig redigerede tider. Manglende udstempling skal stadig afklares af planlæggeren.
- En fremtidig egen vagt kan tilbydes en søgbar kollega. Modtagerens `workflowRespond` accepterer eller afslår, og accepterede tilbud afventer fortsat planlæggergodkendelse.
- Chat respekterer serverens `Retry-After`, øger ventetiden med jitter efter fejl og lader ikke et gammelt succesrespons ophæve en nyere throttle. Klient-ID fastholdes ved genforsøg på afsendelse.

Serverlogout har en krypteret SecureStore-kø med højst 16 originbundne jobs og serverens sessionsudløb. Et kølagt token må ikke genoprette en session efter et afbrudt logout; det bruges alene til logout-requesten. Køen prøves igen ved opstart/forgrund og fjerner først et job ved serverens ACK eller kendt udløb. Hvis kølagring fejler, gennemføres lokal logout stadig, serverlogout forsøges direkte, og appen oplyser ærligt, at serverlukning ikke er bekræftet. Det er ingen garanti for serverrevokering, mens en enhed forbliver offline, afinstalleres eller ikke kan gemme køen.

## Offline reading

The employee app keeps a bounded, encrypted read model of completed own schedule windows and previously opened shift details, including their downloaded instructions and permitted worksite information. It does not cache payroll or chat. The cipher payload lives in the OS cache directory; its AES-256-GCM key is held in device-only, when-unlocked SecureStore. Authenticated additional data binds it to the API origin and current session token hash. No raw token or plaintext instructions are written to the cache file. OS cache eviction simply makes those observations unavailable offline.

Offline identity/read access expires at the earlier of 24 hours after the last successful session verification or the actual session expiry. On startup an unexpired cached identity may display its read model while the server checks the credential. Clocking, checklist changes, leave requests and other mutations remain disabled until current server authorization is acknowledged. Connection failure can retain this read-only view; server 401/403 responses purge cached access. Logout and account/credential replacement synchronously invalidate cache leases before asynchronous cleanup, so delayed old requests cannot recreate a previous account's cache.

Only fully collected calendar pages are committed. Files are replaced after authenticated encryption and are limited to 2 MiB, 24 resources and 512 KiB per resource. Oversized individual descriptions remain intact online and are skipped for offline storage. Offline data is explicitly marked with its last download time; an unseen period or unopened/oversized detail requires a connection. Cached clock registrations, GPS enforcement values and checklist write signatures are never restored as authority. Reconnecting verifies the session and refreshes displayed resources before enabling changes.

A never-opened shift can still show its basic date, time and address from a fresh, complete cached own calendar window. This view is marked `offlineSummary`, contains no instructions, checklist progress/signature or clock/GPS authority, and is not saved as a point receipt. A downloaded point has priority; an explicit withdrawn/null point cannot be resurrected by a remaining window. Calendar projections stay compact when opened details update them, so descriptions and worksite guidance are stored only once in the point cache.
