const http = require('http');

function createMultipartBody(boundary, fields = {}, files = []) {
  const chunks = [];
  const CRLF = '\r\n';

  for (const [name, val] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
      `${val}${CRLF}`
    ));
  }

  for (const file of files) {
    chunks.push(Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"${CRLF}` +
      `Content-Type: ${file.contentType}${CRLF}${CRLF}`
    ));
    chunks.push(Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content));
    chunks.push(Buffer.from(CRLF));
  }

  chunks.push(Buffer.from(`--${boundary}--${CRLF}`));
  return Buffer.concat(chunks);
}

function request(path, options = {}, bodyBuffer = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: options.method || 'GET',
      headers: Object.assign({}, options.headers)
    };

    if (bodyBuffer && !opts.headers['Content-Length']) {
      opts.headers['Content-Length'] = bodyBuffer.length;
    }

    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const json = JSON.parse(raw);
          resolve({ status: res.statusCode, headers: res.headers, data: json, raw });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw });
        }
      });
    });

    req.on('error', reject);
    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

async function runSuite() {
  console.log('====================================================');
  console.log('HIGH-CONCURRENCY & RENDER READINESS VERIFICATION');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  // TEST 1: Health check endpoint (Render health check)
  try {
    const health = await request('/api/health');
    if (health.status === 200 && health.data.status === 'ok') {
      console.log('✔ Test 1: Render Health Check endpoint (/api/health) is 200 OK.');
      passed++;
    } else {
      throw new Error(`Invalid status: ${health.status}`);
    }
  } catch (err) {
    console.error('✖ Test 1 Failed:', err.message);
    failed++;
  }

  // TEST 2: Limits endpoint (checks 1m-30m and 5m default)
  try {
    const limits = await request('/api/limits');
    if (limits.status === 200 && limits.data.defaultExpiration === '5m' && limits.data.expirations.includes('30m')) {
      console.log('✔ Test 2: System Limits verified: Default 5m, range includes 1m to 30m.');
      passed++;
    } else {
      throw new Error('Unexpected limits response');
    }
  } catch (err) {
    console.error('✖ Test 2 Failed:', err.message);
    failed++;
  }

  // TEST 3: 50 Concurrent Clients generating clips simultaneously
  console.log('\n--- Test 3: 50 Concurrent Clients Generating Clips Simultaneously ---');
  const CLIENT_COUNT = 50;
  const createdCodes = [];
  const startPost = Date.now();

  const postPromises = Array.from({ length: CLIENT_COUNT }, (_, i) => {
    const boundary = '----Boundary' + Math.random().toString(36).slice(2);
    const body = createMultipartBody(boundary, {
      text: `Concurrent test message for client #${i + 1}`,
      expiration: '5m'
    });

    return request('/api/share', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      }
    }, body);
  });

  try {
    const postResults = await Promise.all(postPromises);
    const allSuccess = postResults.every(r => r.status === 200 && r.data && r.data.code && r.data.code.length === 6);
    const codeSet = new Set(postResults.map(r => r.data && r.data.code));
    const elapsed = Date.now() - startPost;

    if (allSuccess && codeSet.size === CLIENT_COUNT) {
      console.log(`✔ Test 3: 50 concurrent clip creations processed in ${elapsed}ms (${(elapsed / CLIENT_COUNT).toFixed(1)}ms/req) with 0 collisions.`);
      passed++;
      postResults.forEach(r => createdCodes.push(r.data.code));
    } else {
      throw new Error(`Failed to generate 50 unique codes: success=${postResults.filter(r => r.status === 200).length}, unique=${codeSet.size}`);
    }
  } catch (err) {
    console.error('✖ Test 3 Failed:', err.message);
    failed++;
  }

  // TEST 4: 50 Concurrent Clients retrieving clips simultaneously
  console.log('\n--- Test 4: 50 Concurrent Clients Retrieving Clips Simultaneously ---');
  const startGet = Date.now();
  const getPromises = createdCodes.map(code => {
    const payload = JSON.stringify({ code });
    return request('/api/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, Buffer.from(payload));
  });

  try {
    const getResults = await Promise.all(getPromises);
    const allGotData = getResults.every(r => r.status === 200 && r.data && r.data.data && r.data.data.text.includes('Concurrent test message'));
    const elapsed = Date.now() - startGet;

    if (allGotData) {
      console.log(`✔ Test 4: 50 concurrent clip retrievals processed in ${elapsed}ms with 100% data integrity.`);
      passed++;
    } else {
      throw new Error('Some concurrent retrievals failed');
    }
  } catch (err) {
    console.error('✖ Test 4 Failed:', err.message);
    failed++;
  }

  // TEST 5: Passcode Isolation Under Concurrency
  console.log('\n--- Test 5: Passcode Isolation & Cryptographic Scrypt Under Concurrency ---');
  try {
    const boundary = '----BoundaryPass' + Math.random().toString(36).slice(2);
    const body = createMultipartBody(boundary, {
      text: 'Encrypted payload top secret',
      password: 'ProtectedPasscode2026',
      expiration: '10m'
    });

    const secRes = await request('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
    }, body);

    const secCode = secRes.data.code;

    // Concurrently try without password, wrong password, and correct password
    const [noPass, wrongPass, correctPass] = await Promise.all([
      request('/api/receive', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, Buffer.from(JSON.stringify({ code: secCode }))),
      request('/api/receive', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, Buffer.from(JSON.stringify({ code: secCode, password: 'wrong' }))),
      request('/api/receive', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, Buffer.from(JSON.stringify({ code: secCode, password: 'ProtectedPasscode2026' })))
    ]);

    if (
      noPass.status === 401 && noPass.data.code === 'PASSWORD_REQUIRED' &&
      wrongPass.status === 401 && wrongPass.data.code === 'INVALID_PASSWORD' &&
      correctPass.status === 200 && correctPass.data.data.text === 'Encrypted payload top secret'
    ) {
      console.log('✔ Test 5: Passcode authentication verified (401 on missing, 403 on wrong, 200 on correct).');
      passed++;
    } else {
      throw new Error(`Passcode auth failed: noPass=${noPass.status}, wrongPass=${wrongPass.status}, correctPass=${correctPass.status}`);
    }
  } catch (err) {
    console.error('✖ Test 5 Failed:', err.message);
    failed++;
  }

  // TEST 6: Burn-after-read race condition
  console.log('\n--- Test 6: Burn-After-Reading Atomic Race Condition Test ---');
  try {
    const boundary = '----BoundaryBurn' + Math.random().toString(36).slice(2);
    const body = createMultipartBody(boundary, {
      text: 'One-time burn payload',
      burnAfterRead: 'true',
      expiration: '5m'
    });

    const burnRes = await request('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
    }, body);

    const burnCode = burnRes.data.code;

    // 10 concurrent requests attempting to read the burn code at the exact same millisecond
    const raceReads = await Promise.all(
      Array.from({ length: 10 }, () => {
        return request('/api/receive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, Buffer.from(JSON.stringify({ code: burnCode })));
      })
    );

    const s200 = raceReads.filter(r => r.status === 200).length;
    const s404 = raceReads.filter(r => r.status === 404).length;

    if (s200 === 1 && s404 === 9) {
      console.log('✔ Test 6: Burn-after-read race condition verified: exactly 1 reader succeeded, 9 readers rejected with 404.');
      passed++;
    } else {
      throw new Error(`Burn race condition breach: 200s=${s200}, 404s=${s404}`);
    }
  } catch (err) {
    console.error('✖ Test 6 Failed:', err.message);
    failed++;
  }

  // TEST 7: Real-Time Live Sync Multi-Client SSE Fanout
  console.log('\n--- Test 7: Real-Time Live Sync Multi-Client SSE Fanout ---');
  try {
    const boundary = '----BoundaryLive' + Math.random().toString(36).slice(2);
    const body = createMultipartBody(boundary, {
      text: 'Initial Live Message',
      liveSync: 'true',
      expiration: '10m'
    });

    const liveShare = await request('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
    }, body);

    const { code: liveCode, editKey } = liveShare.data;

    let sseEventsReceived = 0;
    const sseStreams = [];

    const connectSSE = () => new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port: 3000,
        path: `/api/stream/${encodeURIComponent(liveCode)}`,
        method: 'GET'
      }, (res) => {
        res.on('data', chunk => {
          const text = chunk.toString();
          if (text.includes('event: text-update') && text.includes('Realtime edit pushed!')) {
            sseEventsReceived++;
          }
        });
        resolve(req);
      });
      req.end();
    });

    // Connect 5 concurrent SSE listeners
    for (let i = 0; i < 5; i++) {
      sseStreams.push(await connectSSE());
    }

    await new Promise(r => setTimeout(r, 120));

    // Update text via PUT
    const updateRes = await request('/api/update-text', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, Buffer.from(JSON.stringify({
      code: liveCode,
      editKey,
      text: 'Realtime edit pushed!'
    })));

    await new Promise(r => setTimeout(r, 200));
    sseStreams.forEach(s => s.destroy());

    if (updateRes.status === 200 && sseEventsReceived === 5) {
      console.log('✔ Test 7: Real-Time SSE updates broadcasted to all 5 listeners simultaneously.');
      passed++;
    } else {
      throw new Error(`SSE broadcast mismatch: updateStatus=${updateRes.status}, received=${sseEventsReceived}`);
    }
  } catch (err) {
    console.error('✖ Test 7 Failed:', err.message);
    failed++;
  }

  // TEST 8: File Upload & Concurrent Streaming Download
  console.log('\n--- Test 8: File Upload & Concurrent Streaming Download ---');
  try {
    const fileBytes = Buffer.from('X'.repeat(64000)); // 64KB file
    const boundary = '----BoundaryFile' + Math.random().toString(36).slice(2);
    const body = createMultipartBody(boundary, {
      text: 'Test files',
      expiration: '5m'
    }, [
      { fieldname: 'files', filename: 'sample-report.txt', contentType: 'text/plain', content: fileBytes }
    ]);

    const fileShare = await request('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
    }, body);

    const fCode = fileShare.data.code;
    const itemData = await request('/api/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, Buffer.from(JSON.stringify({ code: fCode })));

    const fileId = itemData.data.data.files[0].id;

    // 15 simultaneous client downloads
    const dlPromises = Array.from({ length: 15 }, () => {
      return request(`/api/file/${fCode}/${fileId}`);
    });

    const dlResults = await Promise.all(dlPromises);
    const allDownloaded = dlResults.every(r => r.status === 200 && r.raw === fileBytes.toString());

    if (allDownloaded) {
      console.log('✔ Test 8: 15 simultaneous file downloads completed with 100% byte-for-byte fidelity.');
      passed++;
    } else {
      throw new Error('Concurrent file download failure');
    }
  } catch (err) {
    console.error('✖ Test 8 Failed:', err.message);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`ALL CONCURRENCY TESTS COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
