Scripts to play with my SwitchBot temperature sensors + mini hub.

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
