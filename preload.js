const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sttBridge', {
  onRecordingStateChanged: (callback) => {
    ipcRenderer.on('recording-state-changed', (_event, state) => callback(state));
  },

  sendAudioChunk: (chunk) => {
    ipcRenderer.send('audio-chunk', chunk);
  },

  onTranscription: (callback) => {
    ipcRenderer.on('transcription', (_event, data) => callback(data));
  },

  onError: (callback) => {
    ipcRenderer.on('error', (_event, message) => callback(message));
  },

  minimizeWindow: () => {
    ipcRenderer.send('window-minimize');
  },

  closeWindow: () => {
    ipcRenderer.send('window-close');
  },

  toggleRecording: () => {
    ipcRenderer.send('toggle-recording');
  }
});
