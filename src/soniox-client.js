const WebSocket = require('ws');
const config = require('./config');

class SonioxClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
    this.onTokenCallback = null;
    this.onErrorCallback = null;
    this.onConnectedCallback = null;
    this.onDisconnectedCallback = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.isClosingManually = false;
    this.lastFinalText = '';
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.isClosingManually = false;
      this.reconnectAttempts = 0;

      try {
        this.ws = new WebSocket(config.SONIOX_WS_URL);

        this.ws.on('open', () => {
          console.log('Connected to Soniox');

          const configMessage = JSON.stringify({
            api_key: this.apiKey,
            model: config.SONIOX_MODEL,
            audio_format: config.AUDIO_FORMAT,
            sample_rate: config.AUDIO_SAMPLE_RATE,
            num_channels: config.AUDIO_CHANNELS,
            language_hints: config.LANGUAGE_HINTS,
            language_hints_strict: true,
            enable_endpoint_detection: true
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

        this.ws.on('close', (code, reason) => {
          console.log(`Soniox WebSocket closed: ${code}`);
          this.onDisconnectedCallback?.();

          if (!this.isClosingManually && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.pow(2, this.reconnectAttempts) * 1000;
            console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
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
    this.lastFinalText = '';

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

  _handleMessage(data) {
    try {
      const response = JSON.parse(data.toString());

      if (response.error_code) {
        console.error('Soniox error:', response.error_message);
        this.onErrorCallback?.(response.error_message);
        return;
      }

      if (response.finished) {
        console.log('Soniox session finished');
        return;
      }

      const tokens = response.tokens || [];
      const newFinalText = [];

      for (const token of tokens) {
        if (token.is_final) {
          newFinalText.push(token.text);
        }
      }

      if (newFinalText.length > 0) {
        const fullFinalText = newFinalText.join('');

        if (fullFinalText.length > this.lastFinalText.length) {
          const newText = fullFinalText.substring(this.lastFinalText.length);
          this.lastFinalText = fullFinalText;

          if (newText.trim().length > 0) {
            this.onTokenCallback?.(newText);
          }
        }
      }
    } catch (err) {
      console.error('Failed to parse Soniox response:', err);
    }
  }
}

module.exports = SonioxClient;
