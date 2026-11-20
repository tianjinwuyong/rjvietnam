import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const webDir = path.join(root, 'apps', 'web');
const factory3dDir = path.join(webDir, 'factory3d');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const supplierPortalDir = path.join(root, 'services', 'supplier-portal-api');
const supplierPortalDb = path.join(root, '.runtime', 'supplier-portal.db');
const supplierSyncKey = process.env.SUPPLIER_PORTAL_SYNC_KEY || process.env.WMS_SYNC_KEY || 'supplier-portal-dev-sync';

function startApi() {
  const api = spawn('node', ['services/api/server.js'], {
    cwd: root, stdio: 'pipe',
    env: { ...process.env, HOST: '0.0.0.0', SUPPLIER_PORTAL_SYNC_KEY: supplierSyncKey },
  });
  api.stdout.on('data', (d) => process.stdout.write('[api] ' + d));
  api.stderr.on('data', (d) => process.stderr.write('[api:err] ' + d));
  api.on('exit', (code) => { console.log('API exited: ' + code + ', restarting...'); setTimeout(startApi, 1000); });
}

function startVite() {
  const vite = spawn('node', [viteBin, '--port', '5178', '--host', '0.0.0.0'], {
    cwd: webDir, stdio: 'pipe',
    env: { ...process.env, HOST: '0.0.0.0', VITE_DEV_SERVER_HOST: '0.0.0.0', VITE_API_BASE: 'http://127.0.0.1:8080' },
  });
  vite.stdout.on('data', (d) => process.stdout.write('[vite:web] ' + d));
  vite.stderr.on('data', (d) => process.stderr.write('[vite:web:err] ' + d));
  vite.on('exit', (code) => { console.log('Vite (web) exited: ' + code + ', restarting...'); setTimeout(startVite, 1000); });
}

function startSupplierPortal() {
  const portal = spawn('py', ['-3.14', '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8098'], {
    cwd: supplierPortalDir, stdio: 'pipe',
    env: { ...process.env, SUPPLIER_PORTAL_DB: supplierPortalDb, ENABLE_TEST_LOGIN: '1', COOKIE_SECURE: '0', WMS_API_URL: 'http://127.0.0.1:8080', WMS_SYNC_KEY: supplierSyncKey },
  });
  portal.stdout.on('data', (d) => process.stdout.write('[supplier-portal] ' + d));
  portal.stderr.on('data', (d) => process.stderr.write('[supplier-portal:err] ' + d));
  portal.on('exit', (code) => { console.log('Supplier portal exited: ' + code + ', restarting...'); setTimeout(startSupplierPortal, 1000); });
}

function startFactory3d() {
  const vite = spawn('node', [viteBin, '--port', '5179', '--host', '0.0.0.0'], {
    cwd: factory3dDir, stdio: 'pipe',
    env: { ...process.env, HOST: '0.0.0.0', VITE_DEV_SERVER_HOST: '0.0.0.0', VITE_API_BASE: 'http://127.0.0.1:8080' },
  });
  vite.stdout.on('data', (d) => process.stdout.write('[vite:factory3d] ' + d));
  vite.stderr.on('data', (d) => process.stderr.write('[vite:factory3d:err] ' + d));
  vite.on('exit', (code) => { console.log('Vite (factory3d) exited: ' + code + ', restarting...'); setTimeout(startFactory3d, 1000); });
}

function startScheduler() {
  // The cadence loop is a first-class dev service: it creates drafts on its
  // own schedule, so it is supervised exactly like the API instead of being
  // left to somebody's terminal. VE_SCHEDULER=off keeps a quiet session.
  if (String(process.env.VE_SCHEDULER || '').toLowerCase() === 'off') {
    console.log('[ve-scheduler] disabled (VE_SCHEDULER=off)');
    return;
  }
  const tick = Math.max(15, Number(process.env.VE_SCHEDULER_TICK || 60));
  const scheduler = spawn('node', ['scripts/ve-scheduler.mjs', '--tick=' + tick], {
    cwd: root, stdio: 'pipe', env: { ...process.env },
  });
  scheduler.stdout.on('data', (d) => process.stdout.write('[ve-scheduler] ' + d));
  scheduler.stderr.on('data', (d) => process.stderr.write('[ve-scheduler:err] ' + d));
  scheduler.on('exit', (code) => {
    // Exit 0 is deliberate: another scheduler holds this database's advisory
    // lock, so restarting would only spin. Any other code is a crash.
    if (code === 0) { console.log('[ve-scheduler] exited cleanly (another scheduler owns the lock) — not restarting'); return; }
    console.log('VE scheduler exited: ' + code + ', restarting...');
    setTimeout(startScheduler, 2000);
  });
}

// DEV_SERVICES lets a developer run just one piece (e.g. DEV_SERVICES=scheduler
// during integration checks) without changing the file. Default: all five.
const enabled = new Set((process.env.DEV_SERVICES || 'api,supplier-portal,web,factory3d,scheduler').split(','));
if (enabled.has('api')) startApi();
if (enabled.has('supplier-portal')) startSupplierPortal();
if (enabled.has('web')) startVite();
if (enabled.has('factory3d')) startFactory3d();
if (enabled.has('scheduler')) setTimeout(startScheduler, 2000);
