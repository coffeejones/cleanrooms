# Isoleret iPhone-flow med den rigtige backend

Serveren binder **kun `127.0.0.1:8791`**. Den bruger egne syntetiske konti og `qa/iphone-flow/.runtime/fixture.sqlite`, alle repoets SQL-migrationer og de faktiske private Workspace-, mobil-, chat-, løn- og gatewayhandlers. Den kontakter aldrig produktions-API'et. Administratorkald har en fast, syntetisk QA-identitet; ingen administratoridentitet sendes gennem mobilgatewayen.

Telefonens app skal fortsat betjenes gennem dens rigtige UI. Denne harness udfører ikke medarbejderens login, tjeklister eller stemplinger automatisk.

## Start og konfiguration

Kør fra `New project`:

```sh
node qa/iphone-flow/server.mjs
```

Første kørsel opretter virksomheden, to medarbejdere, app-login, løngruppe med 180 kr./time + 12 kr./time i servicetillæg, vagtserie, tjeklister, ekstra vagt uden GPS, kollega, en ledig morgendagsvagt og afdelingens chatrum via de rigtige handlers. Vagterne er **kun kladder**, indtil planlæggeren udgiver dem. En genstart genbruger samme isolerede database, startkode og fixtureklokke.

Start helt forfra, kun når den eksisterende telefonrunde er afsluttet:

```sh
node qa/iphone-flow/server.mjs --reset
```

`--reset` fjerner alene de kendte fixturefiler under `.runtime`. Brug `shutdown` nedenfor før genstart. Ingen filer i web- eller mobilprojektet ændres.

Expo/Metro skal startes med:

```text
EXPO_PUBLIC_CLEANROOMS_AUTH_URL=http://127.0.0.1:8791
```

Genstart bundleren med den variabel; URL'en skal bruges som origin, uden `/api/mobile-auth`. HTTP-loopback accepteres kun af appens development-build. `127.0.0.1` er beregnet til iPhone-simulator på denne Mac; en fysisk iPhone kan ikke nå Mac-serveren via sin egen loopback.

Login til den syntetiske **QA Freja** findes i serverens startoutput og i `status` nedenfor. Det er en rigtig backendcredential til netop den isolerede QA-database. Ingen produktionskonti eller hemmeligheder bruges. `.runtime` indeholder kun syntetiske testdata og er ignoreret.

GPS-arbejdsstedets testplacering er **55.6761, 12.5683**, radius **200 m**. Rodagenten kan sætte simulatorens placering til dette punkt og selv acceptere appens lokationstilladelse. Den efterfølgende vagt ved **QA Servicecenter** har GPS slået fra. Selve GPS-input og stemplinger skal komme fra appen; harness omgår ikke backendens GPS-regler.

## Administratorkommandoer

Alle CLI-kald går til loopback og kræver harnessens lokale kontrolheader. Ingen produktionshandlinger foretages.

```sh
node qa/iphone-flow/qa-cli.mjs status
node qa/iphone-flow/qa-cli.mjs publish '{"weeks":1,"includeDistant":true}'
node qa/iphone-flow/qa-cli.mjs review
```

`publish` bruger den faktiske versionsstyrede plan-write og udgivelse. `weeks` kan være 1 eller 2. `includeDistant:true` udgiver også den særskilte syntetiske vagt 40 dage frem; dens besked skal være synlig i indbakken uden at udvide kalenderperioden.

Skift en fremtidig vagt, og udgiv ændringen:

```sh
node qa/iphone-flow/qa-cli.mjs change
node qa/iphone-flow/qa-cli.mjs change '{"shiftId":"qa-distant-change","start":"11:00","end":"12:00"}'
node qa/iphone-flow/qa-cli.mjs chat '{"text":"Ny besked fra QA-planlæggeren."}'
```

`change` uden argumenter flytter morgendagens vagt én time. Planlægningsændringen gennemgår både gemning og udgivelse. `review` viser faktisk planrevision, virksomhedens timebudget, registreringer, afvigelsesvurdering og eventuelle godkendte lønsnapshots.

`approve`, `reject` og `correct` vælger som standard dagens hovedvagt. Brug `{"shiftId":"..."}` eller `{"entryId":"..."}` fra `review` for en anden konkret registrering; medarbejdertilhørsforholdet kontrolleres stadig. `entryId` kræver den nye serverversion efter genstart, mens `shiftId` også findes i den første version.

## Clock-in → pause → clock-out → godkendelse

1. Udgiv planen med CLI. Log derefter ind gennem telefonens UI.
2. Åbn dagens vagt ved **QA Hovedkontor**, se kollega og beskrivelse, og markér tjeklistepunkter.
3. Stem ind gennem UI med den rigtige, aktuelle simulatorplacering. Hold fixtureklokken på offset 0 indtil GPS-indstemplingen er lykkedes.
4. Fremskriv fixtureklokken, åbn/opdatér den relevante skærm på telefonen, og brug UI-knapperne til pause og genoptagelse:

```sh
node qa/iphone-flow/qa-cli.mjs clock '{"advanceMinutes":20}'
# Tryk Pause på telefonen.
node qa/iphone-flow/qa-cli.mjs clock '{"advanceMinutes":5}'
# Genoptag på telefonen.
node qa/iphone-flow/qa-cli.mjs clock '{"advanceMinutes":35}'
# Stem ud på telefonen.
node qa/iphone-flow/qa-cli.mjs review
node qa/iphone-flow/qa-cli.mjs approve
```

Godkendelse findes selv i den faktiske `timeWrite`-handler og fastfryser lønnen fra den rigtige gruppe. CLI bruger registreringens aktuelle CAS-version; intet snapshot fabrikkeres. Hvis en konkret registrering følger den aftalte plan, kan den strammere gennemgang prøves:

```sh
node qa/iphone-flow/qa-cli.mjs approve '{"onlyIfMatchesPlan":true}'
```

Vagten er planlagt med start ved fixtureoprettelsen og 5 minutters pause. Den tid, der går under selve UI-testen, er rigtig registreret tid og lægges oven i fremskrivningerne. Hvis medarbejderen først stempler ind et par minutter senere, er en afvigelse derfor forventet. Brug `review`-resultatets faktiske minutter og lønberegning frem for et på forhånd opdigtet beløb.

Ved standardgruppen er forventningen før skat **192 kr./time × godkendte nettominutter / 60**, afrundet af den rigtige lønmodel. Løn og arbejdstimer på mobilen skal først stige ved udstempling; godkendelsen skal derefter kunne ses ved opdatering.

Returflow og eventuel planlæggerrettelse:

```sh
node qa/iphone-flow/qa-cli.mjs reject '{"reason":"Bekræft ankomsten med planlæggeren."}'
# Send forklaring igen gennem telefonens UI.
node qa/iphone-flow/qa-cli.mjs correct '{"start":"12:30","end":"13:30","breakMinutes":5,"reason":"QA: ankomst og sluttid bekræftet."}'
node qa/iphone-flow/qa-cli.mjs approve
```

Brug selv de tider, der passer til testens vagt. `correct` er en planlæggerhandling med begrundelse og audit; medarbejderen får ikke ret til at ændre stemplingstider.

En personlig lønundtagelse kan tilføjes via de rigtige løn- og gruppehandlers:

```sh
node qa/iphone-flow/qa-cli.mjs personal-rate '{"hourlyCents":20000}'
```

Det skifter gruppens grundlønvalg til personlig grundløn for QA Freja; gruppens servicetillæg bevares. Kommandoen er tænkt som én ændring pr. frisk fixture. Godkendte tidligere lønsnapshots skal forblive uændrede.

## Fixtureklokken

Kun den dedikerede Nodeproces bruger en virtuel `Date`, og kun mens en serialiseret handler kører. Mac'ens systemur og telefonens ur ændres aldrig. Rigtige timere og netværkstimeouts forbliver rigtige. Det virtuelle ur er realtid plus fixtureoffset; et request kan ikke få klokken ændret midt i sin transaktion.

Der kan fremskrives 0–180 minutter pr. kommando og højst 12 timer i hele fixturekørslen. Der er ingen tilbagespoling under en registrering. Klokken sender ikke push: skift fane eller opdatér på telefonen, så nye servermålinger hentes. Den native monotone tæller skal kunne genbaseres uden et spring fra telefonens anderledes vægur.

**Efter fremskrivning er en ny GPS-indstempling ikke mulig med telefonens gamle tidsstempel**, før en ny fixture oprettes. Det er den faktiske GPS-friskhedskontrol. Brug den allerede startede vagt til resten af flowet eller den særskilte vagt uden GPS. Undlad at deaktivere produktets timestamp-kontrol for at få QA til at passere.

## Netfejl og tabt svar efter commit

Midlertidig lokal API-afbrydelse:

```sh
node qa/iphone-flow/qa-cli.mjs fault '{"offline":true}'
# Prøv den relevante handling gennem telefonens UI.
node qa/iphone-flow/qa-cli.mjs fault '{"offline":false}'
```

Dette simulerer et HTTP 503-udfald, ikke telefonens radio-/flytilstand. Ingen medarbejderhandler udføres under det simulerede udfald.

Tabt udstemplingssvar efter faktisk commit:

```sh
node qa/iphone-flow/qa-cli.mjs fault '{"afterCommit":"finish"}'
# Stem ud gennem telefonens UI; backend gemmer, men det første svar bliver 503.
node qa/iphone-flow/qa-cli.mjs review
```

Appens normale detail-read/CAS-reconciliation skal genfinde kvitteringen uden at oprette endnu en registrering. Samme engangsfejl kan sættes på `start`, `pause`, `resume` eller `submit`. `afterCommit:null` rydder flaget uden at udføre en handling.

## Stop, genstart og spor

```sh
node qa/iphone-flow/qa-cli.mjs shutdown
node qa/iphone-flow/server.mjs
```

En genstart indlæser den aktuelle backendkode og bevarer de syntetiske data. `.runtime/manifest.json` har fixturemetadata og kun den syntetiske startkode; `.runtime/fixture.sqlite` er aldrig en kopi af driftsdatabasen. `status.recentCalls` viser de seneste handlingstyper og statuskoder, uden bearer-tokens eller passwords fra apprequests.

Harnessen er QA-værktøj, ikke en ny produktbackend, loginmetode, GPS-omgåelse, UI-mockup eller produktionsdeployment.

## Separat pilotrunde

`node qa/iphone-flow/server.mjs --pilot` starter en tredje, uafhængig fixture på **127.0.0.1:8793** med `.pilot-runtime`. Tilføj `--pilot` til CLI-kald, eksempelvis `node qa/iphone-flow/qa-cli.mjs --pilot review`, og brug `EXPO_PUBLIC_CLEANROOMS_AUTH_URL=http://127.0.0.1:8793` til den lokale native afprøvning. De eksisterende 8791- og 8792-forløb berøres ikke. Stop/genstart bevarer data; `--reset` er kun til en afsluttet, disponibel pilotrunde.

Ekstra kontroller til fejl- og beskedforløb:

```sh
node qa/iphone-flow/qa-cli.mjs --pilot cancel '{"shiftId":"qa-distant-change"}'
node qa/iphone-flow/qa-cli.mjs --pilot requests
node qa/iphone-flow/qa-cli.mjs --pilot decide-request '{"requestId":"ID-fra-requests","decision":"approve"}'
node qa/iphone-flow/qa-cli.mjs --pilot fault '{"afterCommit":"chatSend"}'
node qa/iphone-flow/qa-cli.mjs --pilot fault '{"delayMs":1500}'
node qa/iphone-flow/qa-cli.mjs --pilot fault '{"delayMs":0,"offline":false}'
node qa/iphone-flow/qa-cli.mjs --pilot expire-session
```

`cancel` gemmer og udgiver aflysningen gennem de faktiske planhandlers. `decide-request` bruger planlæggerens aktuelle planrevision og anmodningens version. Den tabte chatkvittering sker efter faktisk commit; eksplicit retry skal bruge samme clientId og give samme besked. `expire-session` ændrer kun den syntetiske medarbejders sessionsudløb i den lokale fixturedatabase. Det er en kontrolleret sessionstest, ikke en ændring af telefonens eller Mac’ens ur.

## Separat automatisk HTTP-smoke

```sh
node qa/iphone-flow/smoke.mjs
```

Denne test starter sin egen server **kun på `127.0.0.1:8792`**, nulstiller alene `.smoke-runtime` og stopper serveren igen efter testen. Den berører aldrig 8791- eller 8793-fixturen eller telefonens konto. Den kontrollerer de rigtige HTTP-handlers for kladdeprivathed, udgivelse, fjernændringsbeskeder, tjeklister, GPS-indstempling, pause, udstempling med tabt kvittering, versionssikker genlæsning, retur/genindsendelse uden ændret klokkeevidens, godkendelse, frosset løn, ledig vagt og planlæggergodkendelse, aflysning og indbakkedestination, chat-idempotens efter tabt kvittering, offline recovery samt udløbet session og nyt login. Det er et supplement til telefonens manuelle UI-test, ikke et bevis for native rendering eller produktionsinfrastruktur.
