# Afhængigheder og kendte fund

Kontrolleret 4. november 2026 med `npm audit --omit=dev`. Dette er en lokal appdemo; gennemført funktionstest er ikke en produktionsgodkendelse.

## Runtime: afkodning af deep links

SDK 57-pakken `expo-router@57.0.29` afhænger af `query-string@7.1.3`, som bruger `decode-uri-component@0.2.2`. Der findes to kendte denial-of-service-fund ved afkodning af ugyldige procentkodede strenge: [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) og [GHSA-qr28-fpjm-wq7f](https://github.com/advisories/GHSA-qr28-fpjm-wq7f). Et manipuleret deep link med sådanne query-værdier kan blokere klientens JavaScript-tråd under rutning. Det er en tilgængelighedsrisiko, ikke dokumentation for adgang til andre brugeres data.

[Version 0.5.1](https://github.com/SamVerschueren/decode-uri-component/releases/tag/v0.5.1) erstatter gentagen afkodning med en enkelt gennemløbning, men er ESM med en default-eksport. `query-string@7` forventer en direkte kaldbar CommonJS-eksport. En isoleret prøve med de rigtige npm-pakker gav `typeof require('decode-uri-component') === 'object'` og `decodeComponent is not a function` ved almindelig `parse('name=Jonas%20Hansen')`. Et direkte override til 0.5.1 er derfor ikke anvendt.

Den nye afkoder blev særskilt prøvet med gyldig dansk Unicode, ugyldige procentsekvenser, BOM, afbrudt UTF-8 og 300.000 ugyldigt kodede tegn. Afkoderen håndterer disse; det er integrationens moduleksport, der skal løses.

Før produktionsudgivelse skal kæden opdateres gennem en SDK 57-kompatibel Router-rettelse eller en afprøvet SDK-opgradering. En eventuel CommonJS-backport kræver separat kilde-/licensgennemgang, tests af query-parsing og deep links samt bundling på begge native platforme. At validere appens egne route-parametre alene lukker ikke en fejl, der kan opstå tidligere i Routerens parser.

## Udviklings- og byggeværktøjer

De øvrige fund i den oprindelige runtime-audit kommer hovedsageligt gennem Expos medfølgende CLI-, konfigurations- og byggeværktøjer (`glob`, `minimatch`, `deepmerge`, `zod`). npm klassificerer disse som produktionsafhængigheder, fordi de følger `expo`, selv om de ikke dermed alle indgår i telefonens JavaScript-bundle. Følg SDK-kompatible sikkerhedsopdateringer, og gennemgå fundene igen ved en egentlig release.

Kør ikke `npm audit fix --force` ukritisk. Det foreslog blandt andet Expo 51 eller Router 58 i dette SDK 57-projekt, hvilket ændrer den understøttede platform og kan ødelægge Expo Go-kompatibiliteten.
