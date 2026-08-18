## CLI to show my SwitchBot temperature sensors via mini hub

After setting your secret API credentials in the `.env` file, you can run these commands (tested on MacOS):

```sh
# 1. print sensor values
$ node --env-file=.env switchbot-temps.js

  ┌─────────┬────────────────┬─────────────┬──────────┬─────────┬───────────┐
  │ (index) │ name           │ temperature │ humidity │ battery │ co2       │
  ├─────────┼────────────────┼─────────────┼──────────┼─────────┼───────────┤
  │ 0       │ 'Bureau'       │ '29.5 °C'   │ '38 %'   │ '~60 %' │ undefined │
  │ 1       │ 'Chambre'      │ '29.2 °C'   │ '40 %'   │ '~60 %' │ undefined │
  │ 2       │ 'Moniteur CO2' │ '28.6 °C'   │ '41 %'   │ '~33 %' │ '418 ppm' │
  │ 3       │ 'Salon'        │ '27.7 °C'   │ '47 %'   │ '~60 %' │ undefined │
  └─────────┴────────────────┴─────────────┴──────────┴─────────┴───────────┘

# 2. watch + warn vocally whenever a temperature has changed since last reading
$ node --env-file=.env switchbot-temps.js --watch

  🗣️ la température de Moniteur CO2 a augmenté de 0.1 degrés
```

## Web dashboard (GitHub Pages + Cloudflare Worker)

`index.html` is the phone-friendly dashboard. It fetches readings from a Cloudflare
Worker, so the SwitchBot API token and secret never reach GitHub Pages or the browser.

1. Regenerate the SwitchBot credentials that were exposed, then log into Cloudflare:

  ```sh
  npx wrangler login
  ```

2. Before deployment, set `ALLOWED_ORIGIN` in `wrangler.toml` to the exact GitHub
  Pages origin (for this repository, normally `https://adrienjoly.com`). Deploy:

  ```sh
  npx wrangler deploy
  ```

3. Add the regenerated credentials as encrypted Worker secrets. Enter each value only
  at the terminal prompt; do not put them in `wrangler.toml` or commit them:

  ```sh
  npx wrangler secret put SWITCHBOT_API_TOKEN
  npx wrangler secret put SWITCHBOT_API_SECRET
  ```

4. Deploy again, then copy the printed `https://...workers.dev` URL into `WORKER_URL`
  in `index.html`, adding `/readings` at the end. Publish `index.html` with GitHub
  Pages. The dashboard polls the Worker every five minutes and saves only readings
  history in the browser's local storage.

The Worker endpoint is CORS-limited to the Pages origin. This protects the credentials,
but not the returned temperatures from someone who knows the Worker URL; do not treat it
as an access-controlled private API.
