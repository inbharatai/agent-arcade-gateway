import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const ingestFailures = new Counter('ingest_failures');
const streamFailures = new Counter('stream_failures');
const unauthorizedRate = new Rate('unauthorized_rate');

const baseUrl = __ENV.GATEWAY_URL || 'http://localhost:8787';
const sessionId = __ENV.SESSION_ID || 'k6-session';
const token = __ENV.GATEWAY_TOKEN || '';
const apiKey = __ENV.GATEWAY_API_KEY || '';
const signature = __ENV.SESSION_SIGNATURE || '';

function authHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  if (signature) {
    headers['x-session-signature'] = signature;
  }

  return headers;
}

export const options = {
  scenarios: {
    health: {
      executor: 'constant-vus',
      vus: Number(__ENV.HEALTH_VUS || 5),
      duration: __ENV.HEALTH_DURATION || '30s',
      exec: 'healthScenario',
    },
    ingest: {
      executor: 'ramping-vus',
      exec: 'ingestScenario',
      stages: [
        { duration: __ENV.INGEST_RAMP_UP || '30s', target: Number(__ENV.INGEST_VUS || 25) },
        { duration: __ENV.INGEST_HOLD || '60s', target: Number(__ENV.INGEST_VUS || 25) },
        { duration: __ENV.INGEST_RAMP_DOWN || '20s', target: 0 },
      ],
    },
    stream: {
      executor: 'constant-vus',
      vus: Number(__ENV.STREAM_VUS || 10),
      duration: __ENV.STREAM_DURATION || '45s',
      exec: 'streamScenario',
      startTime: __ENV.STREAM_START || '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1200'],
    ingest_failures: ['count<5'],
    stream_failures: ['count<5'],
    unauthorized_rate: ['rate==0'],
  },
};

export function healthScenario() {
  const res = http.get(`${baseUrl}/health`);
  const ok = check(res, {
    'health status is 200': r => r.status === 200,
  });

  if (!ok) {
    ingestFailures.add(1);
  }

  sleep(1);
}

export function ingestScenario() {
  const payload = JSON.stringify({
    v: 1,
    ts: Date.now(),
    sessionId,
    agentId: `agent-${__VU}`,
    type: 'agent.state',
    payload: {
      state: 'thinking',
      label: `k6 iteration ${__ITER}`,
      progress: (__ITER % 100) / 100,
    },
  });

  const res = http.post(`${baseUrl}/v1/ingest`, payload, {
    headers: authHeaders(),
  });

  const ok = check(res, {
    'ingest accepted': r => r.status === 200,
  });

  if (res.status === 401 || res.status === 403) {
    unauthorizedRate.add(1);
  }

  if (!ok) {
    ingestFailures.add(1);
  }

  sleep(0.2);
}

export function streamScenario() {
  const query = new URLSearchParams({ sessionId });
  if (signature) {
    query.set('sig', signature);
  }
  if (token) {
    query.set('token', token);
  }
  if (apiKey) {
    query.set('apiKey', apiKey);
  }

  const res = http.get(`${baseUrl}/v1/stream?${query.toString()}`, {
    headers: authHeaders(),
    timeout: __ENV.STREAM_TIMEOUT || '5s',
  });

  const ok = check(res, {
    'stream endpoint responded': r => r.status === 200,
  });

  if (res.status === 401 || res.status === 403) {
    unauthorizedRate.add(1);
  }

  if (!ok) {
    streamFailures.add(1);
  }

  sleep(1);
}
