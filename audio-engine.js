export class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.audioElement = new Audio();
        // Enable CORS for visualizer data access
        this.audioElement.crossOrigin = "anonymous";
        
        this.source = null;
        this.analyser = null;
        this.gainNode = null;
        this.isInitialized = false;
        
        this.dataArray = null;
        this.bufferLength = 0;
        
        this.currentUrl = '';
        this.retryCount = 0;
        this.onError = null; // External callback

        // Internal error handler for retry logic
        this.audioElement.onerror = (e) => this._handleInternalError(e);
    }

    _handleInternalError(e) {
        const error = this.audioElement.error;
        console.warn("Audio error:", error ? error.code : "unknown", error ? error.message : "");

        // Retry logic for CORS/Loading failures
        if (this.audioElement.crossOrigin === "anonymous" && this.retryCount === 0) {
            console.warn("Audio Engine: CORS load failed. This often happens if the media server doesn't support the Origin header. Retrying without CORS (Visualizer will be disabled). Source:", this.currentUrl);
            this.retryCount++;
            this.audioElement.removeAttribute('crossOrigin');
            this.audioElement.src = this.currentUrl;
            this.audioElement.load();
            
            // Attempt to resume playback if we were trying to play
            const playPromise = this.audioElement.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    // Abort errors are expected during reload
                    if (err.name !== 'AbortError') console.error("Retry playback error:", err);
                });
            }
            return;
        }

        // If generic error or retry failed, notify external handler
        if (this.onError) this.onError(e);
    }

    init() {
        if (this.isInitialized) return;
        
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.audioContext.createAnalyser();
        this.gainNode = this.audioContext.createGain();
        
        this.source = this.audioContext.createMediaElementSource(this.audioElement);
        this.source.connect(this.analyser);
        this.analyser.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);
        
        this.analyser.fftSize = 2048;
        this.bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(this.bufferLength);
        
        this.isInitialized = true;
    }

    loadTrack(url) {
        // Simple conversion for Dropbox links to ensure direct access
        let processedUrl = url;
        if (url.includes('dropbox.com') && !url.includes('dl.dropboxusercontent.com')) {
            processedUrl = url.replace('www.dropbox.com', 'dl.dropboxusercontent.com')
                              .replace(/\?dl=0$/, '')
                              .replace(/&dl=0$/, '');
        }

        this.currentUrl = processedUrl;
        this.retryCount = 0;
        // Always try with CORS first for visualizer
        this.audioElement.crossOrigin = "anonymous";
        this.audioElement.src = processedUrl;
        this.audioElement.load();
    }

    play() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        return this.audioElement.play();
    }

    pause() {
        this.audioElement.pause();
    }

    seek(percent) {
        if (this.audioElement.duration) {
            this.audioElement.currentTime = (percent / 100) * this.audioElement.duration;
        }
    }

    getOscilloscopeData() {
        if (!this.analyser) return null;
        this.analyser.getByteTimeDomainData(this.dataArray);
        return this.dataArray;
    }

    get currentTime() {
        return this.audioElement.currentTime;
    }

    get duration() {
        return this.audioElement.duration;
    }

    get isPlaying() {
        return !this.audioElement.paused;
    }
}