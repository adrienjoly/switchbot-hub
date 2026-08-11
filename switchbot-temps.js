#!/usr/bin/env node
/**
 * Fetch the current temperature of every temperature-capable SwitchBot device
 * (Meters, Outdoor Meters, Meter Pro, Hub 2/3, ...) via the SwitchBot Cloud API v1.1.
 *
 * Usage:
 *   node --env-file=.env switchbot-temps.js            # human-readable table
 *   node --env-file=.env switchbot-temps.js --json     # machine-readable JSON
 *
 * Requires Node 20.6+ (native --env-file support, global fetch).
 * No npm dependencies. API_TOKEN and API_KEY come from the .env file.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BASE_URL = 'https://api.switch-bot.com/v1.1';

/** Device types whose /status payload carries a temperature reading. */
const TEMP_DEVICE_TYPES = new Set([
  'Meter',
  'MeterPlus',
  'MeterPro',
  'MeterPro(CO2)',
  'WoIOSensor', // Indoor/Outdoor Thermo-Hygrometer
  'Hub 2',
  'Hub 3',
]);

// ---------------------------------------------------------------------------
// .env loading (minimal, no dependency)
// ---------------------------------------------------------------------------

function loadEnv(file = path.join(process.cwd(), '.env')) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// Auth + HTTP
// ---------------------------------------------------------------------------

function authHeaders(token, secret) {
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const sign = crypto
    .createHmac('sha256', secret)
    .update(Buffer.from(token + t + nonce, 'utf8'))
    .digest('base64');

  return {
    Authorization: token,
    sign,
    t,
    nonce,
    'Content-Type': 'application/json; charset=utf8',
  };
}

async function apiGet(endpoint, token, secret) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'GET',
    headers: authHeaders(token, secret),
  });

  if (!res.ok) {
    throw new Error(`GET ${endpoint} -> HTTP ${res.status} ${res.statusText}`);
  }

  const payload = await res.json();
  // SwitchBot always returns HTTP 200 and signals errors in statusCode.
  if (payload.statusCode !== 100) {
    const hint =
      payload.statusCode === 401
        ? ' (check API_TOKEN / API_KEY — the signature is built from both)'
        : payload.statusCode === 190
          ? ' (device offline, unsupported, or daily call limit reached)'
          : '';
    throw new Error(
      `GET ${endpoint} -> statusCode ${payload.statusCode}: ${payload.message}${hint}`,
    );
  }
  return payload.body;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** Run tasks with limited concurrency to stay polite with the API. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function getTemperatures(token, secret) {
  const { deviceList = [] } = await apiGet('/devices', token, secret);

  let candidates = deviceList.filter((d) => TEMP_DEVICE_TYPES.has(d.deviceType));
  // Fallback: if nothing matched (new/unknown model), probe every physical device.
  const probingAll = candidates.length === 0;
  if (probingAll) candidates = deviceList;

  const readings = await pool(candidates, 4, async (device) => {
    try {
      const status = await apiGet(`/devices/${device.deviceId}/status`, token, secret);
      if (typeof status.temperature !== 'number') return null;
      return {
        name: device.deviceName,
        deviceId: device.deviceId,
        deviceType: device.deviceType,
        temperature: status.temperature,
        humidity: status.humidity ?? null,
        co2: status.CO2 ?? null,
        battery: status.battery ?? null,
      };
    } catch (err) {
      return { name: device.deviceName, deviceId: device.deviceId, error: err.message };
    }
  });

  return readings.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printTable(readings) {
  if (readings.length === 0) {
    console.error('No temperature-capable devices found on this account.');
    return;
  }
  const rows = readings.map((r) => r.error ? { name: r.name, error: r.error } : {
    name: r.name,
    temperature: `${r.temperature.toFixed(1)} °C`,
    humidity: r.humidity !== null ? `${String(r.humidity)} %` : undefined,
    battery: r.battery !== null ? `~${r.battery} %` : undefined,
    co2: r.co2 !== null ? `${r.co2} ppm` : undefined,
  });
  console.table(rows);
}

function buildTemperatureChangeSentence(roomName, previousTemperature, currentTemperature) {
  const diff = currentTemperature - previousTemperature;
  if (diff === 0) return null;

  const diffDegrees = Math.abs(diff).toFixed(1);
  const hasIncreased = diff > 0;
  return `la température de ${roomName} a ${hasIncreased ? 'augmenté' : 'baissé'} de ${diffDegrees} degrés`;
}

async function speakSentence(sentence) {
  return new Promise((resolve) => {
    const child = spawn('say', [sentence], { stdio: 'ignore' });
    child.once('error', () => resolve());
    child.once('close', () => resolve());
  });
}

function getReadingsByName(readings) {
  return new Map(
    readings
      .filter((reading) => typeof reading.temperature === 'number')
      .map((reading) => [reading.name, reading]),
  );
}

async function watchTemperatures(token, secret, options = {}) {
  const { json = false } = options;
  const intervalMs = 5 * 60 * 1000;
  let previousReadings = new Map();

  const runCycle = async () => {
    try {
      const readings = await getTemperatures(token, secret);

      if (json) {
        console.log(JSON.stringify({ readings }, null, 2));
      } else {
        printTable(readings);
      }

      const currentReadings = getReadingsByName(readings);
      for (const [roomName, currentReading] of currentReadings.entries()) {
        const previousReading = previousReadings.get(roomName);
        if (!previousReading || typeof previousReading.temperature !== 'number') continue;

        const sentence = buildTemperatureChangeSentence(
          roomName,
          previousReading.temperature,
          currentReading.temperature,
        );
        if (!sentence) continue;

        console.log(sentence);
        await speakSentence(sentence);
      }

      previousReadings = currentReadings;
    } catch (err) {
      console.error(err.message);
    }

    setTimeout(() => {
      runCycle().catch((err) => console.error(err.message));
    }, intervalMs);
  };

  await runCycle();
}

async function main() {
  loadEnv();

  const token = process.env.API_TOKEN;
  const secret = process.env.API_KEY;
  if (!token || !secret) {
    console.error('Missing API_TOKEN and/or API_KEY (set them in .env or the environment).');
    process.exit(1);
  }

  const watchMode = process.argv.includes('--watch');
  const jsonMode = process.argv.includes('--json');

  if (watchMode) {
    console.log('Watching temperatures every 5 minutes...');
    await watchTemperatures(token, secret, { json: jsonMode });
    return;
  }

  const readings = await getTemperatures(token, secret);

  if (jsonMode) {
    console.log(JSON.stringify({ readings }, null, 2));
  } else {
    printTable(readings);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  buildTemperatureChangeSentence,
  getReadingsByName,
  speakSentence,
};
