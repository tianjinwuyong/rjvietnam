import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const distDir = 'C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\smt-factory-system\\apps\\web\\dist';
const PORT = 5179;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
};

createServer((req, res) => {
  let url = req.url.split('?')[0];
  let filePath = url === '/' ? join(distDir, 'index.html') : join(distDir, url);
  if (!existsSync(filePath)) {
    filePath = join(distDir, 'index.html');
  }
  const ext = extname(filePath);
  const ct = MIME[ext] || 'text/plain';
  res.writeHead(200, { 'Content-Type': ct });
  res.end(readFileSync(filePath));
}).listen(PORT, () => {
  console.log(`Production build served on http://localhost:${PORT}`);
});