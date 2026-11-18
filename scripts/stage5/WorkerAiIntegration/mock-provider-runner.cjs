'use strict';
const { createMockProvider } = require('./ai-mock-provider.js');
if (process.env.ZHIKE_STAGE5_ISOLATED !== '1') throw new Error('Explicit isolated Stage 5 context required');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (Buffer.byteLength(input, 'utf8') > 128 * 1024) throw new Error('Mock payload exceeds test limit'); });
process.stdin.on('end', async () => {
  try {
    const request = JSON.parse(input);
    if (!request.jobId || !request.correlationId || !request.fixture) throw new Error('Mock job identity and fixture required');
    const result = await createMockProvider().analyze(request);
    process.stdout.write(JSON.stringify({ mock: true, jobId: request.jobId, correlationId: request.correlationId, result }));
  } catch { process.stderr.write('Isolated Mock Provider refused the test input'); process.exitCode = 1; }
});
