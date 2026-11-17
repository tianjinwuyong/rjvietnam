const { spawn } = require('child_process');
const path = require('path');

const root = 'C:/Users/tianj/Desktop/越南工厂瑞晶/smt-factory-system';
const factory3dDir = path.join(root, 'apps', 'web', 'factory3d');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

console.log('Starting factory3d dev server...');
console.log('viteBin:', viteBin);
console.log('cwd:', factory3dDir);

const vite = spawn('node', [viteBin, '--port', '5179', '--host', '0.0.0.0'], {
  cwd: factory3dDir,
  stdio: 'pipe',
  env: { ...process.env, HOST: '0.0.0.0' },
});

vite.stdout.on('data', (d) => process.stdout.write('[vite:factory3d] ' + d));
vite.stderr.on('data', (d) => process.stderr.write('[vite:factory3d:err] ' + d));
vite.on('exit', (code) => { console.log('Vite (factory3d) exited: ' + code); });
