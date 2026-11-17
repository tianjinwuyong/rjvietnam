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

startApi();
startSupplierPortal();
startVite();
startFactory3d();
