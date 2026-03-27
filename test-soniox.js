/**
 * Automated Soniox STT test script
 * Downloads an Arabic audio sample and sends it to Soniox,
 * then analyzes the token processing for accuracy.
 */
const WebSocket = require('ws');
const https = require('https');
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const config = require('./src/config');

// Test configurations to try
const TEST_CONFIGS = [
  {
    name: 'Current Settings',
    max_endpoint_delay_ms: 3000,
    language_hints_strict: true,
  },
  {
    name: 'Shorter endpoint (1500ms)',
    max_endpoint_delay_ms: 1500,
    language_hints_strict: true,
  },
  {
    name: 'No strict language',
    max_endpoint_delay_ms: 3000,
    language_hints_strict: false,
  },
];

function downloadAudio(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadAudio(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function testWithConfig(audioBuffer, testConfig) {
  return new Promise((resolve, reject) => {
    const results = {
      name: testConfig.name,
      tokens: [],
      finalTexts: [],
      typedText: '',
      typedParts: [],
      totalMessages: 0,
      corrections: 0,
      droppedChars: 0,
      startTime: Date.now(),
      endTime: null,
    };

    let typedText = '';
    const ws = new WebSocket(config.SONIOX_WS_URL);

    ws.on('open', () => {
      const configMsg = JSON.stringify({
        api_key: process.env.SONIOX_API_KEY,
        model: config.SONIOX_MODEL,
        audio_format: 'auto',
        language_hints: config.LANGUAGE_HINTS,
        language_hints_strict: testConfig.language_hints_strict,
        enable_endpoint_detection: true,
        max_endpoint_delay_ms: testConfig.max_endpoint_delay_ms,
      });
      ws.send(configMsg);

      // Send audio in chunks (simulating real-time)
      const chunkSize = 3840;
      let offset = 0;
      const sendInterval = setInterval(() => {
        if (offset >= audioBuffer.length) {
          clearInterval(sendInterval);
          ws.send(''); // Signal end
          return;
        }
        const end = Math.min(offset + chunkSize, audioBuffer.length);
        ws.send(audioBuffer.slice(offset, end));
        offset = end;
      }, 60);
    });

    ws.on('message', (data) => {
      const response = JSON.parse(data.toString());
      results.totalMessages++;

      if (response.error_code) {
        console.error(`  ERROR: ${response.error_message}`);
        reject(new Error(response.error_message));
        return;
      }

      if (response.finished) {
        results.endTime = Date.now();
        ws.close();
        resolve(results);
        return;
      }

      const tokens = response.tokens || [];
      if (tokens.length === 0) return;

      const hasEnd = tokens.some(t => t.text === '<end>');

      // Simulate our token processing logic
      let filteredTokens = tokens.filter(t => t.text !== '<end>');
      if (hasEnd && filteredTokens.length > 0) {
        const lastToken = filteredTokens[filteredTokens.length - 1];
        if (lastToken.text === '.' || lastToken.text === '،') {
          filteredTokens = filteredTokens.slice(0, -1);
        }
      }
      const currentFullText = filteredTokens.map(t => t.text).join('');

      if (currentFullText.length > 0) {
        if (currentFullText.startsWith(typedText) && currentFullText.length > typedText.length) {
          const newText = currentFullText.substring(typedText.length);
          typedText = currentFullText;
          results.typedParts.push(newText);
        } else if (!currentFullText.startsWith(typedText)) {
          results.corrections++;
          if (currentFullText.length > typedText.length) {
            const newText = currentFullText.substring(typedText.length);
            typedText = currentFullText;
            results.typedParts.push(newText);
          } else {
            typedText = currentFullText;
          }
        }
      }

      if (hasEnd) {
        if (typedText.length > 0) {
          results.finalTexts.push(typedText);
        }
        typedText = '';
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      ws.close();
      results.endTime = Date.now();
      resolve(results);
    }, 60000);
  });
}

async function main() {
  console.log('=== Soniox STT Automated Test ===\n');

  if (!process.env.SONIOX_API_KEY) {
    console.error('ERROR: SONIOX_API_KEY not found in .env');
    process.exit(1);
  }

  // Download Arabic audio sample
  console.log('Downloading Arabic audio sample...');
  let audioBuffer;
  try {
    audioBuffer = await downloadAudio('https://soniox.com/media/examples/coffee_shop.mp3');
    console.log(`Audio downloaded: ${(audioBuffer.length / 1024).toFixed(1)} KB\n`);
  } catch (err) {
    console.error('Failed to download audio:', err.message);
    process.exit(1);
  }

  // Test each configuration
  for (const testConfig of TEST_CONFIGS) {
    console.log(`--- Testing: ${testConfig.name} ---`);
    try {
      const results = await testWithConfig(audioBuffer, testConfig);
      const duration = ((results.endTime - results.startTime) / 1000).toFixed(1);

      console.log(`  Duration: ${duration}s`);
      console.log(`  Messages received: ${results.totalMessages}`);
      console.log(`  Utterances: ${results.finalTexts.length}`);
      console.log(`  Corrections: ${results.corrections}`);
      console.log(`  Total typed parts: ${results.typedParts.length}`);

      const fullText = results.finalTexts.join(' ');
      console.log(`  Full text (${fullText.length} chars):`);
      console.log(`    "${fullText.substring(0, 200)}${fullText.length > 200 ? '...' : ''}"`);
      console.log('');
    } catch (err) {
      console.error(`  FAILED: ${err.message}\n`);
    }
  }

  console.log('=== Test Complete ===');
}

main().catch(console.error);
