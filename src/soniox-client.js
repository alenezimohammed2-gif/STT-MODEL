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
    this.typedText = '';     // What's actually on screen (never shrinks)
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
            max_endpoint_delay_ms: 500
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

  onCorrection(callback) {
    this.onCorrectionCallback = callback;
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
      this.typedText += text;
      this.pendingText = '';
      this.onTokenCallback?.(text);
    }
  }

  _scheduleFlush() {
    if (!this.throttleTimer) {
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        this._flushPending();
      }, 100);
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

      // Build full text from all content tokens
      const currentFullText = tokens
        .filter(t => t.text !== '<end>')
        .map(t => t.text)
        .join('');

      if (currentFullText.length > 0) {
        // committed = what's on screen + what's waiting to be flushed
        const committed = this.typedText + this.pendingText;

        if (currentFullText.startsWith(committed)) {
          // Normal extension - text grows from what we have
          if (currentFullText.length > committed.length) {
            const newText = currentFullText.substring(committed.length);
            this.pendingText += newText;
            this._scheduleFlush();
          }
        } else {
          // Text changed (restructure/correction by Soniox)
          // Find common prefix between committed and currentFullText
          let commonLen = 0;
          const minLen = Math.min(committed.length, currentFullText.length);
          for (let i = 0; i < minLen; i++) {
            if (committed[i] === currentFullText[i]) commonLen = i + 1;
            else break;
          }

          // How many chars we typed that are now wrong
          const wrongChars = committed.length - commonLen;
          // What should replace them + any new text
          const correctText = currentFullText.substring(commonLen);

          if (wrongChars > 0 && wrongChars <= 8 && !hasEnd) {
            // Small correction - use backspace to fix
            this._flushPending();
            const deleteFromTyped = this.typedText.length - commonLen;
            if (deleteFromTyped > 0) {
              this.typedText = this.typedText.substring(0, commonLen);
              this.onCorrectionCallback?.(deleteFromTyped, correctText);
              this.typedText += correctText;
            }
          } else {
            // Large restructure or <end> - adjust position, accept some loss
            this.pendingText = '';
            if (currentFullText.length < this.typedText.length) {
              this.typedText = this.typedText.substring(0, currentFullText.length);
            }
            // If there's new text beyond our position, type it
            if (currentFullText.length > this.typedText.length) {
              const newText = currentFullText.substring(this.typedText.length);
              this.pendingText += newText;
              this._scheduleFlush();
            }
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
