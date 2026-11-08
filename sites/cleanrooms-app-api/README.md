# CleanRooms mobile API gateway

En smal, separat Worker, der videresender `POST /api/mobile-auth` til den private Studio-backend. Medarbejderens bearer-session kontrolleres i backend. Webdelen kan fortsat være privat.

Konfiguration sættes på serveren; [.dev.vars.example](.dev.vars.example) viser navnene uden nøgler:

- `STUDIO_ORIGIN`: din Studio-installations HTTPS-origin uden sti, query, fragment eller loginoplysninger.
- `MOBILE_GATEWAY_KEY`: 64 tilfældige hex-tegn, som skal matche Studio-backendens hemmelighed.
- `STUDIO_SITE_ACCESS_TOKEN`: serverens adgang til den private Sites-installation.

Ingen af hemmelighederne må bruges som `EXPO_PUBLIC_`-variabler eller sendes til appen. Ukendt konfiguration og upstream-fejl returnerer en generisk fejl. Gatewayen accepterer kun JSON på den præcise rute, begrænser request-body til 64 KiB og følger ikke redirects.

```sh
npm test
npm run build
npm run validate
```

Buildet opretter `dist/server/index.js` og kopierer `.openai/hosting.json`. Manifestet indeholder ingen eksisterende installations projekt-id; forbind din egen hosting, før du udgiver.
