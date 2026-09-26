// Apple II Audio Subsystem
// Web Audio API implementation of the 1-bit Apple II toggle speaker ($C030),
// plus authentic Disk II floppy drive motor hum and stepper motor seek chatter.

export class AudioEngine {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.volume = 0.5;

        // Speaker state
        this.speakerState = 0;
        this.lastClickTime = 0;

        // Sound nodes
        this.masterGain = null;
        this.driveGain = null;
        this.motorOsc = null;
        this.motorGain = null;
        this.isMotorRunning = false;
    }

    init() {
        if (this.ctx) return;

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
            console.warn('Web Audio API not supported');
            return;
        }

        try {
            this.ctx = new AudioCtx();

            // Master Volume
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
            this.masterGain.connect(this.ctx.destination);

            // Drive sound channel
            this.driveGain = this.ctx.createGain();
            this.driveGain.gain.setValueAtTime(0.15, this.ctx.currentTime);
            this.driveGain.connect(this.masterGain);
        } catch (e) {
            console.error('Audio initialization error:', e);
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setValueAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime);
        }
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setValueAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime);
        }
        if (!this.enabled && this.isMotorRunning) {
            this.stopMotorSound();
        }
    }

    // Called on every $C030 softswitch toggle
    click() {
        if (!this.enabled || !this.ctx) return;

        const now = this.ctx.currentTime;
        // Limit max rate to prevent buffer congestion
        if (now - this.lastClickTime < 0.0001) return;
        this.lastClickTime = now;

        this.speakerState = 1 - this.speakerState;
        const sign = this.speakerState ? 1.0 : -1.0;

        // Create a fast decaying single pulse
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800 + Math.random() * 200, now);

        gain.gain.setValueAtTime(0.25 * sign, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.006);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(now);
        osc.stop(now + 0.006);
    }

    // Disk II stepper head step sound (metallic chatter click)
    stepSound() {
        if (!this.enabled || !this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140 + Math.random() * 40, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.018);

        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);

        osc.connect(gain);
        gain.connect(this.driveGain);

        osc.start(now);
        osc.stop(now + 0.02);
    }

    // Disk II spindle motor hum
    startMotorSound() {
        if (!this.enabled || !this.ctx || this.isMotorRunning) return;
        this.isMotorRunning = true;

        const now = this.ctx.currentTime;
        this.motorOsc = this.ctx.createOscillator();
        this.motorGain = this.ctx.createGain();

        this.motorOsc.type = 'sine';
        this.motorOsc.frequency.setValueAtTime(60, now); // 60Hz mechanical rotation hum

        this.motorGain.gain.setValueAtTime(0.001, now);
        this.motorGain.gain.linearRampToValueAtTime(0.08, now + 0.1);

        this.motorOsc.connect(this.motorGain);
        this.motorGain.connect(this.driveGain);

        this.motorOsc.start(now);
    }

    stopMotorSound() {
        if (!this.isMotorRunning || !this.ctx) return;
        this.isMotorRunning = false;

        if (this.motorGain && this.motorOsc) {
            const now = this.ctx.currentTime;
            this.motorGain.gain.linearRampToValueAtTime(0.001, now + 0.15);
            this.motorOsc.stop(now + 0.15);
            this.motorOsc = null;
            this.motorGain = null;
        }
    }
}
