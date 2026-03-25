const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const logFile = path.join(process.env.LOCALAPPDATA || process.env.TEMP || 'C:\\Temp', 'stt-debug.log');
function debugLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logFile, line); } catch (e) { /* ignore */ }
}

class SonioxClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
    this.onTokenCallback = null;
    this.onErrorCallback = null;
    this.onConnectedCallback = null;
    this.onDisconnectedCallback = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.isClosingManually = false;
    this.typedText = '';
    // Throttle: accumulate text and send every 120ms
    this.pendingText = '';
    this.throttleTimer = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.isClosingManually = false;
      this.reconnectAttempts = 0;
      this.typedText = '';
      this.pendingText = '';

      try {
        this.ws = new WebSocket(config.SONIOX_WS_URL);

        this.ws.on('open', () => {
          debugLog('Connected to Soniox');

          const configMessage = JSON.stringify({
            api_key: this.apiKey,
            model: config.SONIOX_MODEL,
            audio_format: config.AUDIO_FORMAT,
            sample_rate: config.AUDIO_SAMPLE_RATE,
            num_channels: config.AUDIO_CHANNELS,
            language_hints: config.LANGUAGE_HINTS,
            language_hints_strict: true,
            enable_endpoint_detection: true,
            max_endpoint_delay_ms: 3000
          });

          this.ws.send(configMessage);
          this.onConnectedCallback?.();
          resolve();
        });

        this.ws.on('message', (data) => {
          this._handleMessage(data);
        });

        this.ws.on('error', (err) => {
          console.error('Soniox WebSocket error:', err.message);
          this.onErrorCallback?.(`خطأ في الاتصال: ${err.message}`);
          reject(err);
        });

        this.ws.on('close', (code) => {
          debugLog(`Soniox WebSocket closed: ${code}`);
          this.onDisconnectedCallback?.();

          if (!this.isClosingManually && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(Math.pow(2, this.reconnectAttempts) * 1000, 8000);
            this.onErrorCallback?.(`انقطع الاتصال. إعادة المحاولة ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
            setTimeout(() => this.connect(), delay);
          } else if (!this.isClosingManually) {
            this.onErrorCallback?.('فشل الاتصال بالخدمة. تحقق من الإنترنت.');
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  sendAudio(buffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
    }
  }

  disconnect() {
    this.isClosingManually = true;
    // Flush any pending text before disconnecting
    this._flushPending();
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.typedText = '';
    this.pendingText = '';

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('');
        setTimeout(() => {
          if (this.ws) {
            this.ws.close();
            this.ws = null;
          }
        }, 500);
      } else {
        this.ws.close();
        this.ws = null;
      }
    }
  }

  onToken(callback) {
    this.onTokenCallback = callback;
  }

  onError(callback) {
    this.onErrorCallback = callback;
  }

  onConnected(callback) {
    this.onConnectedCallback = callback;
  }

  onDisconnected(callback) {
    this.onDisconnectedCallback = callback;
  }

  _flushPending() {
    if (this.pendingText.length > 0) {
      const text = this.pendingText;
      this.pendingText = '';
      this.onTokenCallback?.(text);
    }
  }

  _scheduleFlush() {
    if (!this.throttleTimer) {
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        this._flushPending();
      }, 120);
    }
  }

  _handleMessage(data) {
    try {
      const response = JSON.parse(data.toString());

      if (response.error_code) {
        console.error('Soniox error:', response.error_message);
        this.onErrorCallback?.(response.error_message);
        return;
      }

      if (response.finished) {
        debugLog('Soniox session finished');
        return;
      }

      const tokens = response.tokens || [];
      if (tokens.length === 0) return;

      const hasEnd = tokens.some(t => t.text === '<end>');

      // Build full text from ALL tokens, excluding <end> and auto-punctuation before <end>
      let filteredTokens = tokens.filter(t => t.text !== '<end>');
      // Remove trailing "." that Soniox auto-adds before <end>
      if (hasEnd && filteredTokens.length > 0) {
        const lastToken = filteredTokens[filteredTokens.length - 1];
        if (lastToken.text === '.' || lastToken.text === '،') {
          filteredTokens = filteredTokens.slice(0, -1);
        }
      }
      const currentFullText = filteredTokens.map(t => t.text).join('');

      if (currentFullText.length > 0) {
        if (currentFullText.startsWith(this.typedText) &&
            currentFullText.length > this.typedText.length) {
          // Normal extension - type only the new part
          const newText = currentFullText.substring(this.typedText.length);
          this.typedText = currentFullText;
          this.pendingText += newText;
          this._scheduleFlush();
        } else if (!currentFullText.startsWith(this.typedText)) {
          // Text changed (correction by Soniox)
          if (currentFullText.length > this.typedText.length) {
            // Longer text - type the extra characters beyond what we already typed
            const newText = currentFullText.substring(this.typedText.length);
            this.typedText = currentFullText;
            if (newText.length > 0) {
              this.pendingText += newText;
              this._scheduleFlush();
            }
          } else {
            // Same length or shorter - just update tracking
            this.typedText = currentFullText;
          }
        }
      }

      // Reset after end of utterance
      if (hasEnd) {
        this._flushPending();
        this.typedText = '';
      }
    } catch (err) {
      console.error('Failed to parse Soniox response:', err);
    }
  }
}

module.exports = SonioxClient;
