const SWITCHBOT_URL = 'https://api.switch-bot.com/v1.1';
const OUTSIDE_URL = 'https://api.open-meteo.com/v1/forecast?latitude=48.8542&longitude=2.4405&current=temperature_2m&timezone=Europe%2FParis';
const TEMP_DEVICE_TYPES = new Set([
  'Meter',
  'MeterPlus',
  'MeterPro',
  'MeterPro(CO2)',
  'WoIOSensor',
  'Hub 2',
  'Hub 3',
]);

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  return origin === env.ALLOWED_ORIGIN
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {};
}

function responseJson(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

async function authHeaders(token, secret) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(token + timestamp + nonce),
  );
  return {
    Authorization: token,
    sign: btoa(String.fromCharCode(...new Uint8Array(signature))),
    t: timestamp,
    nonce,
    'Content-Type': 'application/json; charset=utf8',
  };
}

async function switchBotGet(endpoint, env) {
  const response = await fetch(SWITCHBOT_URL + endpoint, {
    headers: await authHeaders(env.SWITCHBOT_API_TOKEN, env.SWITCHBOT_API_SECRET),
  });
  if (!response.ok) throw new Error(`SwitchBot HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.statusCode !== 100) throw new Error(`SwitchBot: ${payload.message || 'request rejected'}`);
  return payload.body;
}

async function getReadings(env) {
  const outsideRequest = fetch(OUTSIDE_URL).then((response) => response.json());
  const { deviceList = [] } = await switchBotGet('/devices', env);
  const temperatureDevices = deviceList.filter((device) => TEMP_DEVICE_TYPES.has(device.deviceType));
  const devices = temperatureDevices.length ? temperatureDevices : deviceList;
  const readings = await Promise.all(devices.map(async (device) => {
    try {
      const status = await switchBotGet(`/devices/${device.deviceId}/status`, env);
      if (typeof status.temperature !== 'number') return null;
      return {
        name: device.deviceName,
        temperature: status.temperature,
        humidity: status.humidity ?? null,
        battery: status.battery ?? null,
      };
    } catch {
      return { name: device.deviceName, error: 'Reading unavailable' };
    }
  }));
  const outside = await outsideRequest;
  return [
    { name: 'Exterieur', temperature: outside.current.temperature_2m },
    ...readings.filter(Boolean).sort((left, right) => left.name.localeCompare(right.name, 'fr')),
  ];
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          ...headers,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (new URL(request.url).pathname !== '/readings' || request.method !== 'GET') {
      return responseJson({ error: 'Not found' }, 404, headers);
    }
    if (!env.SWITCHBOT_API_TOKEN || !env.SWITCHBOT_API_SECRET) {
      return responseJson({ error: 'Worker secrets are not configured' }, 500, headers);
    }
    try {
      return responseJson({ readings: await getReadings(env) }, 200, headers);
    } catch (error) {
      console.error(error);
      return responseJson({ error: 'Unable to fetch temperature readings' }, 502, headers);
    }
  },
};