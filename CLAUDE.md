# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Arabic Speech-to-Text desktop app built with Electron. Captures microphone audio, streams it to Soniox `stt-rt-v4` via WebSocket, and types the transcribed Arabic text directly into any focused application using Windows SendInput API.

## Commands

```bash
# Run the app (development)
npm start

# Build Windows installer
npm run build

# Launch from terminal (bypasses VS Code ELECTRON_RUN_AS_NODE)
env -u ELECTRON_RUN_AS_NODE npx electron .
```

## Architecture

### Data Flow

```
Microphone (16kHz PCM) → Renderer (ScriptProcessor 2048 samples)
  → IPC 'audio-chunk' → Main Process
  → WebSocket binary frames → Soniox stt-rt-v4
  → JSON token responses → SonioxClient._handleMessage()
  → throttled 120ms batching → TextOutput.typeText()
  → PowerShell persistent process → C# SendInput (KEYEVENTF_UNICODE)
  → Characters typed into focused app
```

### Process Architecture

- **Main Process** (`main.js`): Window management, system tray, global hotkey (`Ctrl+Alt+L`), IPC hub, orchestrates SonioxClient and TextOutput lifecycle
- **Renderer Process** (`renderer/`): Microphone capture via Web Audio API, volume meter visualization (Canvas + AnalyserNode), UI controls
- **Preload Bridge** (`preload.js`): Exposes `window.sttBridge` with IPC methods for audio, recording control, and window management

### Key Modules

- **`src/soniox-client.js`**: WebSocket client that connects to `wss://stt-rt.soniox.com/transcribe-websocket`. Processes both final and non-final tokens for real-time output. Tracks `typedText` to only emit new characters. Filters `<end>` markers and auto-punctuation. Auto-reconnects with exponential backoff (up to 5 attempts).

- **`src/text-output.js`**: Spawns a persistent PowerShell process that loads a C# `KeySender` class using `SendInput` with `KEYEVENTF_UNICODE`. Text is passed as Base64 (UTF-16LE) to handle Arabic encoding. Each character is sent individually with 5ms delay to prevent key repeat issues. This approach was chosen over clipboard paste (`Ctrl+V`) because clipboard paste causes RTL text ordering issues with Arabic.

- **`src/config.js`**: Central configuration for Soniox API settings, audio format, hotkey, and window dimensions.

## Critical Implementation Details

- **RTL Text Output**: Clipboard-based paste (`Ctrl+V`) causes reversed text ordering in RTL contexts. The app uses `SendInput` with `KEYEVENTF_UNICODE` to type characters individually, which handles RTL correctly.

- **Token Processing**: Soniox sends cumulative token arrays per response. Non-final tokens are typed immediately for real-time feedback. A 120ms throttle batches rapid token updates before sending to PowerShell. When Soniox corrects tokens (text changes), only new characters beyond `typedText.length` are typed.

- **Audio Format**: PCM signed 16-bit little-endian, 16kHz, mono. The renderer converts float32 Web Audio data to int16 via `float32ToInt16()`.

## Environment

Requires `SONIOX_API_KEY` in `.env` file (not committed to git). Get from console.soniox.com.
