# Payroll and reminder UI check

This disposable loopback fixture uses the real Studio account/mobile handlers,
all migrations, the production payroll/profile views, and the sandboxed download
transport. It creates synthetic employees and approved attendance in memory.
It never opens a production database or sends push notifications.

Install dependencies in `sites/cleanrooms-studio`, then run from the repository:

```sh
node qa/payroll-export/server.mjs
```

Open `http://127.0.0.1:8794`. The local terminal prints the synthetic employee's
temporary login; do not reuse it outside this fixture. Restarting resets all data.
The app can be tested with `EXPO_PUBLIC_CLEANROOMS_AUTH_URL` set to that loopback
origin on an iOS simulator. Physical devices cannot use the Mac's loopback URL.
Expo Go cannot demonstrate production push delivery.

The previous calendar month contains two approved one-hour registrations:
hourly pay of DKK 180 plus DKK 12, and a separate DKK 30,000 monthly salary.
Expected closed totals: 120 worked minutes and 3,019,200 øre. The salary appears
once, with no duplicated worked hours on wage rows.

Check closing, downloading the full CSV, a custom profile with employee numbers
`001` and `002`, reopening with a reason, and retaining the earlier revision.
Custom CSV profiles are configurable mappings, not certified vendor import
formats. Keep screenshots and downloaded synthetic files under ignored
`outputs/`; never replace them with customer data.
