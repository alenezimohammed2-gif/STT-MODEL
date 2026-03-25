const recordBtn = document.getElementById('recordBtn');
const recordIcon = document.getElementById('recordIcon');
const recordLabel = document.getElementById('recordLabel');
const statusText = document.getElementById('statusText');
const errorText = document.getElementById('errorText');
const minimizeBtn = document.getElementById('minimizeBtn');
const closeBtn = document.getElementById('closeBtn');
const volumeCanvas = document.getElementById('volumeMeter');
const volumeCtx = volumeCanvas.getContext('2d');

let audioContext = null;
let mediaStream = null;
let scriptProcessor = null;
let analyser = null;
let isRecording = false;
let animationFrame = null;

// Window controls
minimizeBtn.addEventListener('click', () => {
  window.sttBridge.minimizeWindow();
});

closeBtn.addEventListener('click', () => {
  window.sttBridge.closeWindow();
});

// Record button
recordBtn.addEventListener('click', () => {
  window.sttBridge.toggleRecording();
});

function float32ToInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16.buffer;
}

// Draw volume meter
function drawVolumeMeter() {
  const width = volumeCanvas.width;
  const height = volumeCanvas.height;

  volumeCtx.fillStyle = '#0d1117';
  volumeCtx.fillRect(0, 0, width, height);

  if (analyser && isRecording) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const barWidth = (width / bufferLength) * 2.5;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * height;
      const hue = 200 + (dataArray[i] / 255) * 60;
      volumeCtx.fillStyle = `hsla(${hue}, 70%, 55%, 0.9)`;
      volumeCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
      x += barWidth;
      if (x > width) break;
    }

    animationFrame = requestAnimationFrame(drawVolumeMeter);
  } else {
    // Draw idle line
    volumeCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    volumeCtx.lineWidth = 1;
    volumeCtx.beginPath();
    volumeCtx.moveTo(0, height / 2);
    volumeCtx.lineTo(width, height / 2);
    volumeCtx.stroke();
  }
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

    // Analyser for volume visualization
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    scriptProcessor = audioContext.createScriptProcessor(2048, 1, 1);

    scriptProcessor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const int16Buffer = float32ToInt16(inputData);
      window.sttBridge.sendAudioChunk(int16Buffer);
    };

    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    // Start volume visualization
    drawVolumeMeter();
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
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor = null;
  }

  if (analyser) {
    analyser.disconnect();
    analyser = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  // Redraw idle meter
  drawVolumeMeter();
}

// Listen for recording state changes
window.sttBridge.onRecordingStateChanged((recording) => {
  isRecording = recording;
  if (recording) {
    recordBtn.classList.add('recording');
    recordLabel.textContent = 'إيقاف التسجيل';
    statusText.textContent = 'جاري التسجيل...';
    errorText.textContent = '';
    startMicrophone();
  } else {
    recordBtn.classList.remove('recording');
    recordLabel.textContent = 'بدء التسجيل';
    statusText.textContent = 'جاهز - اضغط الزر أو CTRL+ALT+L';
    stopMicrophone();
  }
});

window.sttBridge.onTranscription((data) => {
  // Could show preview text if needed
});

window.sttBridge.onError((message) => {
  errorText.textContent = message;
  setTimeout(() => {
    errorText.textContent = '';
  }, 5000);
});

// Initial draw
drawVolumeMeter();
