const indicator = document.getElementById('indicator');
const statusText = document.getElementById('statusText');
const previewText = document.getElementById('previewText');
const errorText = document.getElementById('errorText');

let audioContext = null;
let mediaStream = null;
let scriptProcessor = null;

function float32ToInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16.buffer;
}

async function startMicrophone() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true
      }
    });

    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(mediaStream);

    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

    scriptProcessor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const int16Buffer = float32ToInt16(inputData);
      window.sttBridge.sendAudioChunk(int16Buffer);
    };

    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);
  } catch (err) {
    console.error('Microphone error:', err);

    let errorMessage = 'خطأ في الميكروفون';
    if (err.name === 'NotAllowedError') {
      errorMessage = 'صلاحية الوصول للميكروفون مرفوضة';
    } else if (err.name === 'NotFoundError') {
      errorMessage = 'لم يتم العثور على ميكروفون';
    }

    errorText.textContent = errorMessage;
  }
}

function stopMicrophone() {
  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
}

window.sttBridge.onRecordingStateChanged((isRecording) => {
  if (isRecording) {
    indicator.classList.add('recording');
    statusText.textContent = 'جاري التسجيل...';
    errorText.textContent = '';
    previewText.textContent = '';
    startMicrophone();
  } else {
    indicator.classList.remove('recording');
    statusText.textContent = 'اضغط CTRL+SHIFT+L';
    stopMicrophone();
  }
});

window.sttBridge.onTranscription((data) => {
  previewText.textContent = data.text;
});

window.sttBridge.onError((message) => {
  errorText.textContent = message;
  setTimeout(() => {
    errorText.textContent = '';
  }, 5000);
});
