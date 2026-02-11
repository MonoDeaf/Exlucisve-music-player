import { playlist } from 'playlist';
import { AudioEngine } from 'audio-engine';

const engine = new AudioEngine();
let currentTrackIndex = 0;

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
        const li = document.createElement('li');
        li.className = `track-item ${index === currentTrackIndex ? 'active' : ''}`;
        li.innerHTML = `
            <div class="track-meta">
                <div class="track-name">${track.title}</div>
            </div>
        `;
        li.onclick = () => selectTrack(index);
        trackListEl.appendChild(li);
    });
}

function selectTrack(index) {
    if (!engine.isInitialized) engine.init();
    
    currentTrackIndex = index;
    const track = playlist[index];
    
    // Update UI
    document.querySelectorAll('.track-item').forEach((el, i) => {
        el.classList.toggle('active', i === index);
    });
    
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
playBtn.onclick = () => {
    if (!engine.isInitialized) {
        engine.init();
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
    
    const data = engine.getOscilloscopeData();
    if (!data) {
        // Draw flat line if no engine
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.stroke();
        return;
    }

    const sliceWidth = canvas.width * 1.0 / engine.bufferLength;
    let x = 0;

    ctx.beginPath();
    for (let i = 0; i < engine.bufferLength; i++) {
        const v = data[i] / 128.0;
        const y = v * canvas.height / 2;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }

        x += sliceWidth;
    }
    ctx.lineTo(canvas.width, canvas.height / 2);

    // Bloom/Glow Pass - reduced slightly for better compatibility
    ctx.shadowBlur = 35;
    ctx.shadowColor = '#ccccfa';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Sharp Core Pass
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ccccfa';
    ctx.stroke();
}

// Initialize
initPlaylist();
draw();