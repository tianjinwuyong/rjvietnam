const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const docxPath = 'C:/Users/tianj/Desktop/越南工厂瑞晶/dc/感应式料架接口文档.docx';
const outDir = 'C:/Users/tianj/AppData/Local/Temp/rack_doc2';

try { fs.rmSync(outDir, { recursive: true }); } catch(e) {}
fs.mkdirSync(outDir, { recursive: true });

const ps = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${docxPath.replace(/'/g, "''")}', '${outDir.replace(/'/g, "''")}')`;
try { execSync(`powershell -Command "${ps}"`, { stdio: 'pipe', timeout: 10000 }); } catch(e) { console.error('extract error:', e.message); }

const xmlPath = path.join(outDir, 'word', 'document.xml');
if (!fs.existsSync(xmlPath)) { console.log('NOT FOUND'); process.exit(1); }

let xml = fs.readFileSync(xmlPath, { encoding: 'utf8', flag: 'r' });

// Extract text runs
const textMatches = xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
const texts = textMatches.map(m => m.replace(/<[^>]*>/g, '').trim()).filter(t => t.length > 0);

// Join into readable paragraphs
const fullText = texts.join('');
console.log('=== PART 1 (0-15000) ===');
console.log(fullText.substring(0, 15000));
console.log('\n=== PART 2 (15000+) ===');
console.log(fullText.substring(15000));
