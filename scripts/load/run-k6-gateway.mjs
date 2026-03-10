import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const quick = args.includes('--quick');

const loadDir = path.resolve(process.cwd(), 'scripts', 'load');
const envList = [
  ['GATEWAY_URL', process.env.GATEWAY_URL || 'http://localhost:8787'],
  ['SESSION_ID', process.env.SESSION_ID || 'load-session'],
  ['GATEWAY_TOKEN', process.env.GATEWAY_TOKEN || ''],
  ['GATEWAY_API_KEY', process.env.GATEWAY_API_KEY || ''],
  ['SESSION_SIGNATURE', process.env.SESSION_SIGNATURE || ''],
  ['HEALTH_VUS', process.env.HEALTH_VUS || '5'],
  ['HEALTH_DURATION', process.env.HEALTH_DURATION || (quick ? '15s' : '30s')],
  ['INGEST_VUS', process.env.INGEST_VUS || (quick ? '15' : '25')],
  ['INGEST_RAMP_UP', process.env.INGEST_RAMP_UP || (quick ? '10s' : '30s')],
  ['INGEST_HOLD', process.env.INGEST_HOLD || (quick ? '20s' : '60s')],
  ['INGEST_RAMP_DOWN', process.env.INGEST_RAMP_DOWN || (quick ? '10s' : '20s')],
  ['STREAM_VUS', process.env.STREAM_VUS || (quick ? '5' : '10')],
  ['STREAM_DURATION', process.env.STREAM_DURATION || (quick ? '20s' : '45s')],
  ['STREAM_TIMEOUT', process.env.STREAM_TIMEOUT || '5s'],
];

const dockerArgs = [
  'run', '--rm', '-i',
  '--network', 'host',
  ...envList.flatMap(([key, value]) => ['-e', `${key}=${value}`]),
  '-v', `${loadDir}:/scripts`,
  'grafana/k6',
  'run', '/scripts/k6-gateway.js',
];

const result = spawnSync('docker', dockerArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`Failed to execute docker: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
