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
        items[index].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
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
    const samplesToDraw = Math.min(window.visualizerTimebase, size);
    
    // Optimization: Draw roughly 2 points per horizontal pixel
    const step = Math.max(1, Math.floor(samplesToDraw / (canvas.width * 2)));
    const pointsCount = Math.floor(samplesToDraw / step);
    const sliceWidth = canvas.width / pointsCount;
    
    // Determine start point in circular buffer
    const startIdx = (index - samplesToDraw + size) % size;

    ctx.beginPath();
    const midY = canvas.height / 2;
    const scaleY = canvas.height / 2;

    ctx.beginPath();
    for (let i = 0; i < pointsCount; i++) {
        const readIdx = (startIdx + (i * step)) % size;
        const v = buffer[readIdx]; // Raw Float32 -1.0 to 1.0
        
        // Invert Y because canvas coordinates go down
        const y = midY - (v * scaleY); 
        const x = i * sliceWidth;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }

    // Performance optimization: No shadow blur
    ctx.strokeStyle = '#ccccfa';
    ctx.lineWidth = 2.0;
    ctx.stroke();
}

// Initialize
initPlaylist();
draw();