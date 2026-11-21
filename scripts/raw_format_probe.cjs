const http = require('http');

function shelfRaw(method, path, body, contentType) {
  return new Promise((resolve) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({
      hostname: '192.168.6.118', port: 8093,
      path, method,
      headers: {
        'Content-Type': contentType || 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'X-Api-Key': 'factory123',
        'Accept': 'application/json',
      }
    }, res => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => resolve({ status: res.statusCode, body: resBody }));
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.write(data);
    req.end();
  });
}

function shelf(method, path, body) {
  return shelfRaw(method, path, body, 'application/json');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Try raw JSON / form-urlencoded / custom headers ===\n');

  // Try form-urlencoded
  const formBody = 'labelIdList[]=TEST&color=6';
  const formRes = await shelfRaw('POST', '/api/shelf/ShelfOut', formBody, 'application/x-www-form-urlencoded');
  console.log(`FORM-urlencoded: ${formRes.status} ${formRes.body.substring(0, 120)}`);

  // Try with extra header
  const extraHeader = await shelfRaw('POST', '/api/shelf/ShelfOut', { labelIdList: ['TEST'], color: 6 }, 'application/json; charset=utf-8');
  console.log(`Extra header: ${extraHeader.status} ${extraHeader.body.substring(0, 120)}`);

  // Try light on with shelf+cell (various formats)
  console.log('\n=== Light on specific cell ===');
  const cellTests = [
    [{ shelfCode: 'L001A', cell: '01', color: 6 }],
    [{ shelfCode: 'L001A', cellLabel: 'L001A01', color: 6 }],
    [{ shelfCode: 'L001A', position: '01', color: 6 }],
    [{ shelfCode: 'L001A', ledNo: '01', color: 6 }],
    [{ shelf: 'L001A', cell: '01', color: 6 }],
    [{ s: 'L001A', c: '01', color: 6 }],
  ];
  const names = ['{shelfCode,cell}', '{shelfCode,cellLabel}', '{shelfCode,position}', '{shelfCode,ledNo}', '{shelf,cell}', '{s,c}'];
  for (let i = 0; i < cellTests.length; i++) {
    const r = await shelf('POST', '/api/shelf/LightOnAllEmptyLocation', cellTests[i]);
    console.log(`  ${names[i]}: ${r.status} ${r.body.substring(0, 100)}`);
  }

  // What if ShelfOut uses a different body format?
  console.log('\n=== Try ShelfOut with different body formats ===');
  const outFormats = [
    [{ labelIds: ['TEST'], color: 6 }],
    [{ LabelIds: ['TEST'], color: 6 }],
    [{ label_id_list: ['TEST'], color: 6 }],
    [{ labelId: 'TEST', color: 6 }],  // single string
    [{ labelIdList: 'TEST', color: 6 }],  // string not array
  ];
  const outNames = ['labelIds', 'LabelIds', 'snake_case', 'single string', 'string not array'];
  for (let i = 0; i < outFormats.length; i++) {
    const r = await shelf('POST', '/api/shelf/ShelfOut', outFormats[i]);
    console.log(`  ${outNames[i]}: ${r.status} ${r.body.substring(0, 100)}`);
  }

  // Try LightOnAllEmptyLocation on different cells
  console.log('\n=== LightOnAllEmptyLocation per cell ===');
  for (const shelfCode of ['L001A', 'L001B', 'L002A', 'L002B']) {
    for (const color of [6, 0]) {
      const r = await shelf('POST', '/api/shelf/LightOnAllEmptyLocation', { shelfCode, color });
      console.log(`  ${shelfCode} color=${color}: ${r.body.substring(0, 60)}`);
      await sleep(400);
    }
  }
}

main().catch(e => console.error('Error:', e.message));
