// launcher.cjs - changes directory then runs npm
// Usage: node launcher.cjs <workspace> <port>
const { execSync, spawn } = require('child_process');
const path = require('path');

const ws = process.argv[2]; // e.g. "services/api"
const port = process.argv[3];
const root = path.join(__dirname, '..'); // project root

// Change to project root (ASCII-safe: use __dirname which is ASCII inside node_modules)
process.chdir(root);

// Find npm
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Run npm dev --workspace=<ws> with output forwarded
const child = spawn(npm, ['run', 'dev', `--workspace=${ws}`], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, FORCE_COLOR: '1' }
});

child.on('exit', (code) => process.exit(code ?? 0));
