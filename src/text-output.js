const { clipboard } = require('electron');
const { exec } = require('child_process');

class TextOutput {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  async typeText(text) {
    if (!text || text.length === 0) return;
    this.queue.push(text);
    if (!this.isProcessing) {
      await this._processQueue();
    }
  }

  async _processQueue() {
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const text = this.queue.shift();
      await this._pasteText(text);
    }

    this.isProcessing = false;
  }

  _pasteText(text) {
    return new Promise((resolve, reject) => {
      const previousClipboard = clipboard.readText();

      clipboard.writeText(text);

      const psCommand = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"`;

      exec(psCommand, (err) => {
        setTimeout(() => {
          clipboard.writeText(previousClipboard);
        }, 100);

        if (err) {
          console.error('Failed to simulate Ctrl+V:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

module.exports = TextOutput;
