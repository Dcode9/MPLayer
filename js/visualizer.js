// ============================================
// AUDIO CONTEXT & VISUALIZER SETUP
// ============================================
let audioContext, analyser, source, isAudioContextInitialized = false;
let smoothedLow = 0, smoothedMid = 0, smoothedHigh = 0;
let currentProgress = 0;
let time = 0;
let hoverIntensity = 0; 
let visualizerCtx;

// ColorThief with fallback
let colorThief;
try {
    colorThief = new ColorThief();
} catch(e) {
    colorThief = {
        getPalette: () => [[62, 207, 142], [100, 150, 200], [50, 100, 150]]
    };
}

let lastFrameTime = 0;
const FPS_INTERVAL = 1000 / 30;

function setupAudioContext() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        source = audioContext.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        analyser.fftSize = 256; 
        isAudioContextInitialized = true;
    } catch(e) { console.warn("WebAudio API missing", e); }
}

function resizeVisualizer() {
    const container = document.getElementById('seek-bar-container');
    const canvas = document.getElementById('visualizer-canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = container.offsetWidth * dpr;
    canvas.height = container.offsetHeight * dpr;
    visualizerCtx.scale(dpr, dpr);
}

const viz = {
    startLoop: () => { requestAnimationFrame(viz.render); },
    render: (timestamp) => {
        requestAnimationFrame(viz.render);
        
        const elapsed = timestamp - lastFrameTime;
        if (elapsed < FPS_INTERVAL) return;
        lastFrameTime = timestamp - (elapsed % FPS_INTERVAL);

        if (!state.loaded) return; 

        const canvas = document.getElementById('visualizer-canvas');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = canvas.width / dpr;
        const height = canvas.height / dpr;
        const centerY = height / 2;
        
        visualizerCtx.clearRect(0, 0, width, height);
        
        const seekTrack = document.getElementById('seek-bar-track');
        if(seekTrack) {
            const progressWidth = width * currentProgress;
            canvas.style.clipPath = `inset(0 ${width - progressWidth}px 0 0)`;
            seekTrack.style.clipPath = `inset(0 0 0 ${currentProgress * 100}%)`;
        }

        time += 0.05; 
        let targetLow = 0, targetMid = 0, targetHigh = 0;

        if (state.playing && isAudioContextInitialized) {
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyser.getByteFrequencyData(dataArray);
            
            targetLow = dataArray.slice(0, 5).reduce((a, b) => a + b, 0) / 5 / 255;
            targetMid = dataArray.slice(10, 40).reduce((a, b) => a + b, 0) / 30 / 255;
            targetHigh = dataArray.slice(80, 150).reduce((a, b) => a + b, 0) / 70 / 255;
            
            const rippleBass = dataArray.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
            const rippleScale = 1 + (rippleBass / 255) * 0.5;
            const ripple = document.getElementById('ripple-effect');
            if(ripple) {
                ripple.style.transform = `translate(-50%, -50%) scale(${rippleScale})`;
                if(state.playing) ripple.classList.add('active');
            }
        }

        // Smoothing
        smoothedLow += (targetLow - smoothedLow) * 0.1;
        smoothedMid += (targetMid - smoothedMid) * 0.1;
        smoothedHigh += (targetHigh - smoothedHigh) * 0.1;

        let verticalScale = 1.0;
        if (audio.duration > 0) {
            const scaleProgress = Math.min(1, currentProgress / 0.4);
            verticalScale = (0.3 + 0.7 * scaleProgress) * 0.8;
        }

        visualizerCtx.beginPath();
        visualizerCtx.moveTo(0, centerY);

        const waveDensity = 0.03;
        const maxWaves = 14;
        const waveCount = Math.min(maxWaves, Math.max(2, (width * currentProgress) * waveDensity));
        const intensity = audio.volume;
        
        const lowPower = Math.pow(smoothedLow, 2.0);
        const midPower = Math.pow(smoothedMid, 1.5);
        
        const isHovering = state.hoverProgress >= 0;
        const targetHoverInt = isHovering ? 1.0 : 0.0;
        hoverIntensity += (targetHoverInt - hoverIntensity) * 0.1;

        for (let x = 0; x <= width; x++) {
            const localProgress = x / (width * currentProgress || 1);
            const taper = Math.sin(localProgress * Math.PI);
            
            const baseWave = Math.sin((x / width) * waveCount * Math.PI);
            const fastWave = Math.sin((x / width) * waveCount * 2.5 * Math.PI + time);
            const slowWave = Math.sin((x / width) * waveCount * 0.5 * Math.PI + time * 0.3);

            const baseAmplitude = (centerY * 0.8) * lowPower * intensity * verticalScale;
            const detailAmplitude = (centerY * 0.2) * midPower * intensity * verticalScale;

            let interactionFactor = 1.0;
            if (hoverIntensity > 0.01) {
                const posToUse = isHovering ? state.hoverProgress : state.lastHoverProgress;
                const hoverX = posToUse * width;
                const dist = Math.abs(x - hoverX);
                const radius = 60; 
                if (dist < radius) {
                    let t = dist / radius;
                    let dip = t * t * (3 - 2 * t);
                    interactionFactor = 1.0 - (hoverIntensity * (1.0 - dip));
                }
            }

            const y = centerY +
                (baseWave * baseAmplitude +
                fastWave * detailAmplitude +
                slowWave * detailAmplitude * 0.5) * taper * interactionFactor;
            
            visualizerCtx.lineTo(x, y);
        }

        visualizerCtx.lineWidth = 2;
        visualizerCtx.strokeStyle = '#fff';
        if(smoothedLow > 0.3) {
            visualizerCtx.shadowColor = 'rgba(255, 255, 255, 0.7)';
            visualizerCtx.shadowBlur = 4 + smoothedHigh * 5; 
        } else {
            visualizerCtx.shadowBlur = 0;
        }
        visualizerCtx.stroke();
    }
};
