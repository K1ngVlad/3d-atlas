#!/usr/bin/env node
// Smoke check: gateway /health and Consul registration of the services. No dependencies.
// Usage: node smoke.mjs [--base http://localhost:8080] [--consul http://localhost:8500]
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1].replace(/\/$/, '') : def;
};
const base = opt('base', 'http://localhost:8080');
const consul = opt('consul', 'http://localhost:8500');

let failed = false;
const report = (ok, text) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${text}`);
  if (!ok) failed = true;
};

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

try {
  const { status, body } = await getJson(`${base}/health`);
  report(status === 200 && body?.status === 'ok', `GET ${base}/health -> ${status} ${JSON.stringify(body)}`);
} catch (e) {
  report(false, `GET ${base}/health -> ${e.message}`);
}

for (const name of ['catalog', 'quiz', 'analytics']) {
  const url = `${consul}/v1/health/service/${name}?passing=true`;
  try {
    const { status, body } = await getJson(url);
    const n = Array.isArray(body) ? body.length : 0;
    report(status === 200 && n >= 1, `consul ${name}: ${n} passing instance(s)`);
  } catch (e) {
    report(false, `consul ${name}: ${e.message}`);
  }
}

process.exit(failed ? 1 : 0);
