import { playlist } from 'playlist';
import { AudioEngine } from 'audio-engine';

const engine = new AudioEngine();
let currentTrackIndex = 0;

// Visualizer settings
// Exposed as window variable for runtime adjustment
window.visualizerTimebase = 6000;

// DOM Elements
const canvas = document.getElementById('oscilloscope');
const ctx = canvas.getContext('2d');
const trackListEl = document.getElementById('track-list');
const playBtn = document.getElementById('play-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const currentTitle = document.getElementById('current-title');
const timebaseSlider = document.getElementById('timebase-slider');

// Initialize Track List UI
function initPlaylist() {
    trackListEl.innerHTML = '';
    playlist.forEach((track, index) => {
        const card = document.createElement('div');
        card.className = `track-item ${index === currentTrackIndex ? 'active' : ''}`;
        card.innerHTML = `
            <div class="track-card-content">
                <div class="track-index">${(index + 1).toString().padStart(2, '0')}</div>
                <div class="track-name">${track.title}</div>
            </div>
        `;
        card.onclick = () => selectTrack(index);
        trackListEl.appendChild(card);
    });
}

async function selectTrack(index) {
    if (!engine.isInitialized) await engine.init();
    
    currentTrackIndex = index;
    const track = playlist[index];
    
    // Update UI
    const items = document.querySelectorAll('.track-item');
    items.forEach((el, i) => {
        el.classList.toggle('active', i === index);
    });

    // Scroll active item into view
    if (items[index]) {
        items[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    currentTitle.textContent = track.title;
    
    engine.loadTrack(track.url);
    engine.play().catch(e => {
        console.error("Playback error:", e);
        currentTitle.textContent = "LOAD ERROR";
    });
    updatePlayPauseUI();
}

// Global error handler for audio engine
engine.onError = () => {
    const code = engine.audioElement.error ? engine.audioElement.error.code : 'UNKNOWN';
    console.error("Audio engine fatal error:", code);
    currentTitle.textContent = "FILE ACCESS DENIED / 404";
};

function updatePlayPauseUI() {
    if (engine.isPlaying) {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
    } else {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
    }
}

// Controls
playBtn.onclick = async () => {
    if (!engine.isInitialized) {
        await engine.init();
        selectTrack(currentTrackIndex);
        return;
    }
    
    if (engine.isPlaying) {
        engine.pause();
    } else {
        engine.play();
    }
    updatePlayPauseUI();
};

nextBtn.onclick = () => {
    let next = currentTrackIndex + 1;
    if (next >= playlist.length) next = 0;
    selectTrack(next);
};

prevBtn.onclick = () => {
    let prev = currentTrackIndex - 1;
    if (prev < 0) prev = playlist.length - 1;
    selectTrack(prev);
};

progressContainer.onclick = (e) => {
    const rect = progressContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = (x / rect.width) * 100;
    engine.seek(percent);
};

timebaseSlider.oninput = (e) => {
    window.visualizerTimebase = parseInt(e.target.value);
};

// Visualization & Update Loop
function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    // Use getBoundingClientRect for more accurate dimensions in iframes
    const rect = canvas.getBoundingClientRect();
    const displayWidth = Math.floor(rect.width * dpr);
    const displayHeight = Math.floor(rect.height * dpr);

    // To prevent "GL_INVALID_FRAMEBUFFER_OPERATION: Attachment has zero size",
    // we ensure the internal canvas dimensions are never 0 if the element is present.
    // We use a minimum of 1x1.
    const finalWidth = Math.max(1, displayWidth);
    const finalHeight = Math.max(1, displayHeight);

    if (canvas.width !== finalWidth || canvas.height !== finalHeight) {
        canvas.width = finalWidth;
        canvas.height = finalHeight;
    }
}

// Use ResizeObserver for more reliable sizing in embedded/iframe contexts
const resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
});

if (canvas) {
    resizeObserver.observe(canvas);
    // Initial call
    resizeCanvas();
}

function draw() {
    requestAnimationFrame(draw);

    // Skip drawing if canvas is not visible or too small to avoid GL/Context errors
    // offsetParent check ensures the element is actually part of the layout
    if (!canvas.offsetParent || canvas.width <= 1 || canvas.height <= 1) {
        return;
    }
    
    // Update Progress UI
    if (engine.isInitialized) {
        const current = engine.currentTime;
        const duration = engine.duration;
        const percent = (current / duration) * 100;
        progressBar.style.width = `${percent || 0}%`;
        
        if (current >= duration && duration > 0) {
            nextBtn.click(); // Auto skip to next
        }
    }

    // Draw Oscilloscope
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const waveData = engine.getOscilloscopeData();
    if (!waveData) {
        // Draw flat line if no engine
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
    }

    const { buffer, index, size } = waveData;
    
    // Smooth Index Interpolation: Corrects for the discrete updates from AudioWorklet blocks
    const now = performance.now();
    const elapsed = now - (engine.lastUpdateTimestamp || now);
    const sampleRate = (engine.audioContext && engine.audioContext.sampleRate) || 44100;
    const additionalSamples = engine.isPlaying ? (elapsed * sampleRate / 1000) : 0;
    // We target the current "now" with a tiny offset to ensure we don't read past the write pointer
    const smoothIndex = (index + additionalSamples * 2 - 2) % size;

    const midX = canvas.width / 2;
    const midY = canvas.height / 2;
    
    // --- DRAW OSCILLOSCOPE (Left Half) ---
    const oscWidth = midX;
    const timebase = window.visualizerTimebase || 6000;
    const samplesToDraw = Math.min(timebase, size / 2);
    
    // Calculate the exact starting sample for this frame
    const startIdxExact = (smoothIndex - (samplesToDraw * 2) + size) % size;
    const startIdx = Math.floor(startIdxExact / 2) * 2; // Keep sample-pair aligned

    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = '#ccccfa';
    ctx.lineWidth = 1.2;

    const samplesPerPixel = samplesToDraw / oscWidth;

    if (samplesPerPixel > 1) {
        // High-fidelity bucket-based rendering to prevent aliasing/flicker
        for (let x = 0; x < oscWidth; x++) {
            const rangeStart = x * samplesPerPixel;
            const rangeEnd = (x + 1) * samplesPerPixel;
            
            let min = 1.0;
            let max = -1.0;
            
            // Check EVERY sample in the bucket for perfect peak stability
            const sStart = Math.floor(rangeStart);
            const sEnd = Math.ceil(rangeEnd);
            
            for (let s = sStart; s < sEnd; s++) {
                const rIdx = (startIdx + (s * 2)) % size;
                const val = buffer[rIdx];
                if (val < min) min = val;
                if (val > max) max = val;
            }

            const yMin = midY - (max * (canvas.height / 2 - 10));
            const yMax = midY - (min * (canvas.height / 2 - 10));
            
            if (x === 0) ctx.moveTo(x, yMin);
            ctx.lineTo(x, yMin);
            ctx.lineTo(x, yMax);
        }
    } else {
        // Interpolated rendering for high zoom levels
        for (let x = 0; x < oscWidth; x++) {
            const samplePos = x * samplesPerPixel;
            const idxBase = Math.floor(samplePos);
            const fract = samplePos - idxBase;
            
            const rIdx1 = (startIdx + (idxBase * 2)) % size;
            const rIdx2 = (startIdx + ((idxBase + 1) * 2)) % size;
            
            const v = buffer[rIdx1] * (1 - fract) + buffer[rIdx2] * fract;
            const y = midY - (v * (canvas.height / 2 - 10));
            
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
    ctx.restore();

    // --- DRAW VECTORSCOPE (Right Half) ---
    const vectorSamples = 1024;
    const vectorScale = (canvas.height / 2) * 0.7;
    const vectorStartIdx = (Math.floor(smoothIndex / 2) * 2 - (vectorSamples * 2) + size) % size;

    ctx.save();
    ctx.translate(midX + midX / 2, midY);
    ctx.beginPath();
    ctx.strokeStyle = '#ff4a00';
    ctx.lineWidth = 1.5;

    for (let i = 0; i < vectorSamples; i++) {
        const rIdx = (vectorStartIdx + (i * 2)) % size;
        const L = buffer[rIdx];
        const R = buffer[rIdx + 1];

        const vx = (L - R) * 0.707;
        const vy = -(L + R) * 0.707;

        const px = vx * vectorScale;
        const py = vy * vectorScale;

        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Draw reference lines for vectorscope
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 8]);
    const refScale = vectorScale * 1.1; // Extend lines slightly beyond the trace area
    ctx.moveTo(-refScale, 0); ctx.lineTo(refScale, 0);
    ctx.moveTo(0, -refScale); ctx.lineTo(0, refScale);
    ctx.stroke();
    ctx.restore();

    // Divider line
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0)';
    ctx.moveTo(midX, 10);
    ctx.lineTo(midX, canvas.height - 10);
    ctx.stroke();
}

// Initialize
initPlaylist();
draw();