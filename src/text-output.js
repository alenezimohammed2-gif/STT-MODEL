const { spawn } = require('child_process');

class TextOutput {
  constructor() {
    this.ps = null;
    this.psReady = false;
    this._startPowerShell();
  }

  _startPowerShell() {
    this.ps = spawn('powershell', [
      '-NoProfile', '-NoLogo', '-NonInteractive', '-Command', '-'
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    // Use SendInput with KEYEVENTF_UNICODE - send one char at a time to avoid struct alignment issues
    const initCode = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class KeySender {
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public InputUnion U;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const uint KEYEVENTF_KEYUP = 0x0002;

    public static void TypeUnicode(string text) {
        if (string.IsNullOrEmpty(text)) return;

        int size = Marshal.SizeOf(typeof(INPUT));
        INPUT[] pair = new INPUT[2];

        for (int i = 0; i < text.Length; i++) {
            ushort ch = (ushort)text[i];

            pair[0] = new INPUT();
            pair[0].type = INPUT_KEYBOARD;
            pair[0].U.ki.wVk = 0;
            pair[0].U.ki.wScan = ch;
            pair[0].U.ki.dwFlags = KEYEVENTF_UNICODE;

            pair[1] = new INPUT();
            pair[1].type = INPUT_KEYBOARD;
            pair[1].U.ki.wVk = 0;
            pair[1].U.ki.wScan = ch;
            pair[1].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;

            SendInput(2, pair, size);
            Thread.Sleep(5);
        }
    }
}
"@
Write-Output "READY"
`;
    this.ps.stdin.write(initCode + '\r\n');

    this.ps.stdout.on('data', (data) => {
      if (data.toString().includes('READY')) {
        this.psReady = true;
        console.log('TextOutput: PowerShell ready');
      }
    });

    this.ps.stderr.on('data', (data) => {
      console.error('PowerShell stderr:', data.toString());
    });

    this.ps.on('error', (err) => {
      console.error('PowerShell process error:', err);
      this.psReady = false;
    });

    this.ps.on('exit', () => {
      this.psReady = false;
    });
  }

  async typeText(text) {
    if (!text || text.length === 0) return;
    if (!this.ps || !this.psReady) return;

    const base64 = Buffer.from(text, 'utf16le').toString('base64');
    this.ps.stdin.write(
      `[KeySender]::TypeUnicode([System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${base64}')))\r\n`
    );
  }

  reset() {}

  destroy() {
    if (this.ps) {
      try {
        this.ps.stdin.end();
        this.ps.kill();
      } catch (e) {}
      this.ps = null;
      this.psReady = false;
    }
  }
}

module.exports = TextOutput;
