# Medarbejderpush

Push erstatter ikke beskederne i databasen og ændrer ingen eksisterende brugerflade. Appen kan hente sin indbakke uden notifikationstilladelse. Push sendes med generiske tekster; navne, arbejdstider, løn, sygdom, kundeadresser og chatindhold sendes ikke til låseskærmen.

## Konti, enheder og åbning

Mobilgatewayens eksisterende bearer-login bruges til:

- `employeePushRegister {installationId, expoPushToken, platform, projectId}` → `{registered:true}`.
- `employeePushUnregister {installationId}` → `{registered:false}`.
- `employeePushTest {installationId}` → `{queued:true}`. Opretter kun en generisk selvtest til den aktuelle session/enhed, højst ét event pr. installation/minut. Ingen modtager eller tekst kan angives. Gentagne tryk er idempotente.
- `employeePushOpen {eventId, installationId}` → `{target:{kind:'shift',shiftId}}`, `{target:{kind:'chat',roomId}}` eller `{target:{kind:'inbox'}}`.

InstallationId er en tilfældig RFC-UUID gemt på enheden. EventId er en servergenereret streng med 32 små hextegn. Appen accepterer kun notifikationsdata `{v:1,eventId,installationId}`; der er ingen betroet URL, arbejdsområde- eller medarbejderidentitet i payloaden. Serveren udleder identiteten fra den aktuelle session og kontrollerer igen installationens ejer og adgangen til den oprindelige vagt, anmodning eller samtale. Aflyste/overdragede vagter kan åbne medarbejderens indbakke i stedet for en anden medarbejders vagt.

Projekt-ID skal matche serverens `EXPO_PROJECT_ID`; et klientvalgt projekt bliver afvist. Raw Expo-adresser opbevares kun på serveren og returneres aldrig af API'et. En medarbejder kan have højst otte aktive installationer. Ældre inaktive registreringer ryddes op i begrænsede portioner ved registrering. En aktiv installation/adresse kan ikke overtages af en anden konto; normalt logout skal først afmelde den gamle binding.

Afmelding er bundet til den session, der registrerede installationen. En forsinket logout-/afmeldingskø fra en gammel session kan derfor ikke slukke en ny binding. SQL-triggeren ved sletning af en mobil session deaktiverer dens adresser atomisk; passwordændring, nulstilling og lukning af appadgang genbruger de eksisterende sessionsletninger. Hvert sendeforsøg validerer desuden live session, credentialversion, aktiv medarbejder, præferencer og aktuel afdelingsadgang.

## Outbox og drift

Migration `0031_employee_push.sql` opretter enheder, events, leveringsforsøg og dispatcherstatus samt fire triggers. Nye ændrings-/anmodningsbeskeder og nye rigtige chatbeskeder skaber ét event i samme transaktion som kilden. Demoer, læste kilder og historik får ikke en automatisk ny pushhistorik: der leveres kun friske events til enheder, som allerede var registreret, da eventet opstod.

Chatfanout går gennem rummets afdeling og de aktuelle arbejdssteders sekundære deviceindeks. Et atomisk directory-trigger ved flyttet arbejdssted holder indekset aktuelt. Fanout læser højst 51 adresser fra ét arbejdssted pr. event og opretter højst 50 leveringsposter; den besøger højst tre chat-events pr. drain. Vagt-/anmodningsbeskeder ekspanderes separat: højst 50 events i én transaktion med pointopslag på medarbejderens adresser. Chat-backlog kan derfor ikke optage udvidelsens plads til nye vagtændringer. Den indledende SQL-filtrering udelukker andre afdelinger, afsenderen, læste eller lydløse samtaler, inaktive credentials og fravalgte chatnotifikationer. Autoriteten valideres igen umiddelbart før transmission.

En fælles databaselease begrænser samtidige drains og højst ét sendebatch i sekundet. Der sendes højst 50 notifikationer, og højst 50 kvitteringer kontrolleres pr. drain. Resultater gemmes med ét JSON-bundet bulk-UPDATE pr. fase, hvor hver række stadig kræver sit eget event-, installations- og forsøgslease-match. Der udføres ikke ét SQL-write pr. ticket eller receipt. Mobilens egne indstillinger for almindelige notifikationer og chatnotifikationer respekteres særskilt. Alle mål læses ved deres nøgler; ingen plan, fuld medarbejderliste eller historisk chattekst indlæses.

Workerens `ctx.waitUntil` forsøger at levere straks efter en vellykket POST. Workerens `scheduled`-handler er også implementeret til en fremtidig almindelig cron. Sites dokumenterer ikke provisionering af Cloudflare-crontriggers; handlerens tilstedeværelse alene aktiverer derfor ingen tidsplan. Den planlagte GitHub-wake er et begrænset driftskald, der kan erstattes af en anden driftsudløser uden ændring af datamodellen.

Den offentlige gateway har en særskilt `POST /api/push-dispatch` med `Content-Type: application/json`, body præcis `{}` og header `X-CleanRooms-Push-Key: <64 hextegn>`. Kaldet kan udelukkende vække allerede gemt arbejde; det kan ikke vælge modtagere eller indhold, læse brugerdata eller omgå almindeligt mobil-login. Gatewayen validerer nøglen med WebCrypto-verifikation, indsætter sin eksisterende private Site-serviceadgang server-side og returnerer kun `{ok:true}`. Forkert nøgle giver 404. Nøglen skal være forskellig fra login-gatewaynøglen og opbevares som en hemmelighed i Studio, gateway og wakejobbet. Ingen Site-serviceadgang eller mobil bearer-token gives til GitHub.

Runtimekonfiguration i Studio:

- `EXPO_PROJECT_ID`: den faktiske Expo-projekt-UUID. Manglende/ugyldig værdi slår kun push fra og giver pushregistrering 503; andre appfunktioner virker fortsat.
- `EXPO_PUSH_ACCESS_TOKEN`: valgfri server-only bearer ved Expos enhanced push security. Appen må aldrig indeholde den.
- `PUSH_DISPATCH_KEY`: separat 32-byte tilfældig nøgle, hexkodet til service-wake.

Gatewayen bruger sin eksisterende `STUDIO_SITE_ACCESS_TOKEN` og den særskilte `PUSH_DISPATCH_KEY`. Den private webdels publikum udvides ikke.

Dispatcherens `last_started_at`, `last_success_at`, `last_error` og `last_provider_error` gemmes ved dens globale statusrække. `readPushDispatchHealth()` læser disse og de ældste afventende poster med indeksopslag. Ved mere end 15 minutters backlog eller provideropsætningsfejl logges et generisk `push_dispatch_backlog`; ingen tokens, ID'er, beskedtekst eller personoplysninger logges. Et planlagt wakejob skal overvåges for fejl/inaktivitet; en tidsplan alene beviser ikke, at APNs virker.

## Kvitteringer, fejl og begrænsninger

Sendeforsøg har en samlet deadline på 25 sekunder og højst otte sekunder pr. providerrequest. Lease og dispatcherejerskab kontrolleres igen før netværket, med mindst ti sekunders lease tilbage. En proces, der har mistet sin lease, sender ikke et nyt batch.

Expos `ok`-ticket betyder modtagelse hos Expo. Dets kvitterings-ID gemmes; senere `ok`-receipt betyder overdragelse til APNs/FCM. Ingen af delene er medarbejderens læsestatus. Receipts kontrolleres efter cirka 15 minutter, derefter i begrænsede intervaller i højst 23 timer. En manglende receipt udløser aldrig gensendelse af en allerede accepteret ticket.

HTTP 429/5xx og eksplicit `MessageRateExceeded` bruger eksponentiel backoff, højst fem forsøg. HTTP 5xx kan principielt komme efter en accepteret transmission; præcis én pushbanner kan derfor ikke garanteres. Stabile collapse/tag-ID'er reducerer dubletter. Netværkstimeout, uventet/ufuldstændigt ticketsvar og en udløbet `sending`-lease markeres `unknown` uden blind automatisk gensendelse. Den autoritative indbakke er stadig tilgængelig.

`DeviceNotRegistered` deaktiverer kun den registreringsversion, der faktisk blev sendt til. En sen fejl for en gammel adresse kan ikke slukke en ny tokenbinding. Hver binding har også en tilfældig servergenereret generation, som gemmes på forsøget; beskyttelsen består, selv hvis en inaktiv enhedsrække ryddes op og dens UUID senere genbruges med et nyt versionsnummer. Fejl i APNs/FCM-credentials deaktiverer ikke gode enheder; de gemmes som en driftsfejl. Afsluttede leveringsposter/events ryddes op i begrænsede portioner efter 30 dage.

Apple-/Firebase-credentials, notifikationstilladelse og den faktiske hardwaretest er eksterne forudsætninger. En grøn unit-/integrationstest eller et HTTP-wake er ikke dokumentation for en modtaget fysisk push.

## Verifikation

`node --test tests/mobile-push.test.cjs tests/push-gateway.test.cjs tests/push-capacity.test.cjs` afprøver de faktiske HTTP-handlers og transaktioner: projekt-/identitetskontrol, malformed typer, atomisk rollback, payloadprivatliv, læsning/indstillinger/mute, konto-/afdelingsskift, logout/revocation, tokenrotation, samtidige leases, mistede svar, ticket-/receiptsemantik, installationsgrænser, D1-statementbudget og den begrænsede gateway. Desuden er samtlige migrationer, inklusive triggerne, anvendt på en separat lokal D1/Miniflare-binding.

Primære kilder: [Expo push API og receipts](https://docs.expo.dev/push-notifications/sending-notifications/), [SDK 57 notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/), [Cloudflare D1 SQL](https://developers.cloudflare.com/d1/sql-api/sql-statements/).

Kapacitetsregressionerne viser 20 friske vagtændringer til samme providerbatch i ét drain med 15 SQL-statements. Et samlet drain med 50 eksisterende receipts og 50 nye sends bruger 18 SQL-statements. Tests kontrollerer desuden mixede success-/retry-/failure-/missing-resultater og en erstattet enkeltlease, så bulk-opdateringen ikke kan overskrive en anden ejer. Tallene er målte statements mod det rigtige storageflow med en simuleret netværksprovider, ikke en garanti for transporttid hos Expo/APNs.
