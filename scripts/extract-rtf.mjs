import fs from 'fs';
// Extract text from RTF - handle Unicode Chinese chars \'xx
const rtf = fs.readFileSync('C:/Users/tianj/Desktop/越南工厂瑞晶/dc/PDA功能(1).rtf', 'latin1');

// Decode RTF string with unicode escapes
let result = '';
let i = 0;
let braceDepth = 0;

while (i < rtf.length) {
  const c = rtf[i];
  if (c === '{') { braceDepth++; i++; continue; }
  if (c === '}') { braceDepth--; i++; continue; }
  if (c === '\\') {
    i++;
    if (i >= rtf.length) break;
    // Hex encoded \'xx
    if (rtf[i] === "'") {
      const hex = rtf.substring(i+1, i+3);
      const code = parseInt(hex, 16);
      if (!isNaN(code)) result += String.fromCharCode(code);
      i += 3;
      continue;
    }
    // Control word
    while (i < rtf.length && /[a-zA-Z]/.test(rtf[i])) i++;
    while (i < rtf.length && /\d/.test(rtf[i])) i++;
    if (i < rtf.length && rtf[i] === ' ') i++;
    continue;
  }
  if (c === '\r' || c === '\n') { result += '\n'; i++; continue; }
  // Only collect text when inside the document body (braceDepth > 0)
  if (braceDepth > 0) {
    const code = c.charCodeAt(0);
    if (code >= 32) result += c;
  }
  i++;
}

// Clean up
const lines = result.split('\n').map(l => l.trim()).filter(l => l.length > 2);
console.log(lines.slice(0, 150).join('\n'));

