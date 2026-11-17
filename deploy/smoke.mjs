#!/usr/bin/env node
// Smoke check through the gateway: health, Consul registration, Catalog/MinIO, a Quiz run
// and its events reaching Analytics via RabbitMQ. No dependencies (Node 18+).
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

// Retry a check while services finish registering in Consul (gateway polls every 5 s).
async function eventually(fn, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fn();
      if (r) return r;
    } catch {
      /* retry */
    }
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function call(method, path, { body, clientId } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (clientId) headers['x-client-id'] = clientId;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const text = method === 'HEAD' ? '' : await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  return { status: res.status, headers: res.headers, body: json };
}

async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    report(false, `${name}: ${e.message}`);
  }
}

// --- Stage 1: Catalog + Gateway + MinIO
await step('catalog manifest', async () => {
  const r = await eventually(async () => {
    const x = await call('GET', '/api/catalog/manifests/animal-cell');
    return x.status === 200 ? x : null;
  });
  const instance = r?.headers.get('x-instance');
  report(!!r && !!instance, `GET /api/catalog/manifests/animal-cell -> ${r?.status ?? 'timeout'}, X-Instance=${instance}`);
  const url = r?.body?.model?.url;
  const head = url ? await call('HEAD', `/${url.replace(/^\//, '')}`) : null;
  const len = head?.headers.get('content-length');
  report(head?.status === 200 && Number(len) > 0, `HEAD /${url} -> ${head?.status}, Content-Length=${len}`);
});

await step('catalog entity', async () => {
  const r = await call('GET', '/api/catalog/entities/mitochondrion');
  report(r.status === 200 && typeof r.body?.title?.ru === 'string', `GET /api/catalog/entities/mitochondrion -> ${r.status}, title.ru=${r.body?.title?.ru}`);
});

await step('catalog 404', async () => {
  const r = await call('GET', '/api/catalog/manifests/nonexistent');
  report(r.status === 404, `GET /api/catalog/manifests/nonexistent -> ${r.status}`);
});

// --- Stage 2/3: Quiz attempt -> RabbitMQ -> Analytics
const summaryBefore = await eventually(async () => {
  const r = await call('GET', '/api/analytics/summary');
  return r.status === 200 ? r.body : null;
});
report(!!summaryBefore, `GET /api/analytics/summary -> ${JSON.stringify(summaryBefore)}`);

await step('quiz flow', async () => {
  const list = await eventually(async () => {
    const r = await call('GET', '/api/quiz/quizzes');
    return r.status === 200 && Array.isArray(r.body) && r.body.length ? r.body : null;
  });
  report(!!list, `GET /api/quiz/quizzes -> ${list?.length ?? 0} quiz(zes)`);
  if (!list) return;
  const quiz = (await call('GET', `/api/quiz/quizzes/${list[0].id}`)).body;
  const leaks = JSON.stringify(quiz).match(/"is_?correct"/i);
  report(!leaks, `GET /api/quiz/quizzes/${quiz.id}: ${quiz.questions.length} questions, no isCorrect`);

  const clientId = crypto.randomUUID();
  const start = async () => (await call('POST', '/api/quiz/attempts', { body: { quizId: quiz.id, clientId }, clientId })).body.attemptId;

  // Attempt 1: "Don't know" everywhere -> learn the correct options, score 0.
  const a1 = await start();
  const correct = {};
  for (const q of quiz.questions) {
    const r = await call('POST', `/api/quiz/attempts/${a1}/answers`, { body: { questionId: q.id, optionIds: [] }, clientId });
    correct[q.id] = r.body?.correctOptionIds ?? [];
  }
  const c1 = await call('POST', `/api/quiz/attempts/${a1}/complete`, { clientId });
  report(c1.body?.score === 0, `attempt 1 (all "don't know") -> score ${c1.body?.score}/${c1.body?.total}`);

  // Attempt 2: first half correct, rest empty.
  const a2 = await start();
  const half = Math.ceil(quiz.questions.length / 2);
  for (const [i, q] of quiz.questions.entries()) {
    const optionIds = i < half ? correct[q.id] : [];
    await call('POST', `/api/quiz/attempts/${a2}/answers`, { body: { questionId: q.id, optionIds }, clientId });
  }
  const dup = await call('POST', `/api/quiz/attempts/${a2}/answers`, { body: { questionId: quiz.questions[0].id, optionIds: [] }, clientId });
  report(dup.status === 409, `repeat answer -> ${dup.status} ${dup.body?.error}`);
  const foreign = await call('GET', `/api/quiz/attempts/${a2}`, { clientId: crypto.randomUUID() });
  report(foreign.status === 404, `GET attempt with foreign X-Client-Id -> ${foreign.status}`);
  const c2 = await call('POST', `/api/quiz/attempts/${a2}/complete`, { clientId });
  const c2again = await call('POST', `/api/quiz/attempts/${a2}/complete`, { clientId });
  report(
    c2.body?.score === half && c2again.body?.completedAt === c2.body?.completedAt,
    `attempt 2 (${half} correct) -> score ${c2.body?.score}/${c2.body?.total}, complete idempotent`,
  );

  // Analytics should see 2 × questions more answers.
  const expected = (summaryBefore?.answersTotal ?? 0) + 2 * quiz.questions.length;
  const after = await eventually(async () => {
    const r = await call('GET', '/api/analytics/summary');
    return r.body?.answersTotal >= expected ? r.body : null;
  }, 10000);
  report(!!after, `analytics answersTotal reached ${expected} -> ${JSON.stringify(after)}`);
});

process.exit(failed ? 1 : 0);
