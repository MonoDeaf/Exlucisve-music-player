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

        // Large history buffer for long-timebase visualization
        // 4M samples is approx 95 seconds at 44.1kHz
        this.historySize = 4194304; 
        this.historyBuffer = new Float32Array(this.historySize);
        this.historyIndex = 0;
        this.workletNode = null;
        
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
            console.log("Audio Engine: CORS load failed. Retrying without CORS (Visualizer will be disabled).");
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

    async init() {
        if (this.isInitialized) return;
        
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        // Request 44.1kHz explicitly, though browser/hardware may override
        this.audioContext = new AudioCtor({
            latencyHint: 'interactive',
            sampleRate: 44100
        });

        this.analyser = this.audioContext.createAnalyser();
        this.gainNode = this.audioContext.createGain();
        
        // Only create source once
        if (!this.source) {
            this.source = this.audioContext.createMediaElementSource(this.audioElement);
        }
        
        // AudioWorklet for high-performance non-blocking visualization
        const workletCode = `
            class VisualizerProcessor extends AudioWorkletProcessor {
                constructor() {
                    super();
                    this.bufferSize = 128;
                    this.buffer = new Float32Array(this.bufferSize);
                    this.index = 0;
                }
                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    if (input && input.length > 0) {
                        const channel = input[0];
                        // Copy data to buffer
                        for (let i = 0; i < channel.length; i++) {
                            this.buffer[this.index++] = channel[i];
                            if (this.index >= this.bufferSize) {
                                this.port.postMessage(this.buffer);
                                this.index = 0;
                            }
                        }
                    }
                    return true;
                }
            }
            registerProcessor('visualizer-processor', VisualizerProcessor);
        `;

        const blob = new Blob([workletCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);

        try {
            await this.audioContext.audioWorklet.addModule(url);
            this.workletNode = new AudioWorkletNode(this.audioContext, 'visualizer-processor');
            
            this.workletNode.port.onmessage = (e) => {
                const input = e.data; // Float32Array from worklet
                const len = input.length;
                const buffer = this.historyBuffer;
                const size = this.historySize;
                let idx = this.historyIndex;
                
                for (let i = 0; i < len; i++) {
                    buffer[idx] = input[i];
                    idx = (idx + 1) % size;
                }
                this.historyIndex = idx;
            };

            // Connect source to worklet (side-chain for visualization only)
            // This does NOT affect the audio output path
            this.source.connect(this.workletNode);
        } catch (e) {
            console.warn("AudioWorklet failed, visualization may be disabled:", e);
        }
        
        // Main Audio Path (High Quality Stereo)
        // Source -> Analyser -> Gain -> Destination
        this.source.connect(this.analyser);
        this.analyser.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);
        
        this.analyser.fftSize = 2048;
        this.bufferLength = this.historySize;
        
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
        if (!this.isInitialized) return null;
        
        // Return the history buffer and the current write index
        // so the visualizer knows where "now" is.
        return {
            buffer: this.historyBuffer,
            index: this.historyIndex,
            size: this.historySize
        };
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