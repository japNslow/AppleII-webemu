// Apple II Emulator Main Orchestrator
// Connects CPU, MMU, Video, Audio, Disk II, Keyboard, and Debugger into a unified experience.

import { CPU6502 } from './cpu6502.js';
import { MMU } from './mmu.js';
import { VideoRenderer } from './video.js';
import { AudioEngine } from './audio.js';
import { Disk2Controller } from './disk2.js';
import { KeyboardManager } from './keyboard.js';
import { Apple2Debugger } from './debugger.js';
import { APPLE2_PLUS_ROM, DISK2_BOOT_ROM } from './roms.js';
import { BUILTIN_DISKS } from './disks.js';

export class Apple2Emulator {
    constructor() {
        this.canvas = document.getElementById('screen');
        this.audio = new AudioEngine();
        this.mmu = new MMU();
        this.cpu = new CPU6502(this.mmu);
        this.video = new VideoRenderer(this.canvas, this.mmu);
        this.diskController = new Disk2Controller(this.audio);

        this.mmu.audio = this.audio;
        this.mmu.diskController = this.diskController;

        this.keyboard = new KeyboardManager(this.mmu, () => this.reset());
        this.debugger = new Apple2Debugger(this.cpu, this.mmu);

        // Execution state
        this.running = false;
        this.speedMultiplier = 1; // 1x = 1.023 MHz
        this.cyclesPerFrame = 17030; // ~1,020,484 / 60
        this.animFrameId = null;

        this.initHardware();
        this.initUI();
    }

    initHardware() {
        // Load System ROM ($D000 - $FFFF) & Disk II Boot ROM ($C600 - $C6FF)
        this.mmu.setSystemRom(APPLE2_PLUS_ROM);
        this.mmu.setSlot6Rom(DISK2_BOOT_ROM);

        // Load default DOS 3.3 disk into Drive 1
        const defaultDisk = BUILTIN_DISKS.find(d => d.id === 'dos33');
        if (defaultDisk && defaultDisk.data) {
            this.diskController.loadDisk(1, defaultDisk.data, defaultDisk.name);
        }

        // Power-on reset
        this.powerOn();
    }

    powerOn() {
        this.mmu.reset();
        this.cpu.reset();
        this.diskController.reset();
    }

    reset() {
        this.cpu.reset();
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.audio.init();
        this.audio.resume();

        let lastTimestamp = performance.now();

        const loop = (timestamp) => {
            if (!this.running) return;

            const targetCycles = Math.floor(this.cyclesPerFrame * this.speedMultiplier);
            let frameCycles = 0;

            while (frameCycles < targetCycles) {
                // Breakpoint check
                if (this.debugger.breakpoints.has(this.cpu.pc)) {
                    this.pause();
                    this.updateDebuggerUI();
                    return;
                }

                const elapsed = this.cpu.step();
                frameCycles += elapsed;
                this.mmu.updatePaddleTimers(elapsed);
            }

            // Render 60 FPS frame
            this.video.render();

            this.animFrameId = requestAnimationFrame(loop);
        };

        this.animFrameId = requestAnimationFrame(loop);
    }

    pause() {
        this.running = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        this.audio.stopMotorSound();
    }

    stepSingleInstruction() {
        const elapsed = this.cpu.step();
        this.mmu.updatePaddleTimers(elapsed);
        this.video.render();
        this.updateDebuggerUI();
    }

    initUI() {
        // Render Virtual Keyboard
        const kbContainer = document.getElementById('virtual-keyboard');
        if (kbContainer) {
            this.keyboard.renderVirtualKeyboard(kbContainer);
        }

        // Toolbar Controls
        const btnPower = document.getElementById('btn-power');
        const btnReset = document.getElementById('btn-reset');
        const btnPlay = document.getElementById('btn-play');
        const selectSpeed = document.getElementById('select-speed');
        const selectColor = document.getElementById('select-color');
        const checkScanlines = document.getElementById('check-scanlines');
        const btnAudio = document.getElementById('btn-audio');
        const volumeSlider = document.getElementById('volume-slider');
        const btnFullscreen = document.getElementById('btn-fullscreen');
        const btnPaste = document.getElementById('btn-paste');
        const btnDebug = document.getElementById('btn-debug');

        if (btnPlay) {
            btnPlay.addEventListener('click', () => {
                if (this.running) {
                    this.pause();
                    btnPlay.innerHTML = '<span class="icon">▶</span> Run';
                } else {
                    this.start();
                    btnPlay.innerHTML = '<span class="icon">⏸</span> Pause';
                }
            });
        }

        if (btnReset) {
            btnReset.addEventListener('click', () => {
                this.reset();
            });
        }

        if (btnPower) {
            btnPower.addEventListener('click', () => {
                this.powerOn();
            });
        }

        if (selectSpeed) {
            selectSpeed.addEventListener('change', (e) => {
                this.speedMultiplier = parseFloat(e.target.value);
            });
        }

        if (selectColor) {
            selectColor.addEventListener('change', (e) => {
                this.video.setColorMode(e.target.value);
            });
        }

        if (checkScanlines) {
            checkScanlines.addEventListener('change', (e) => {
                this.video.setScanlines(e.target.checked);
            });
        }

        if (btnAudio) {
            btnAudio.addEventListener('click', () => {
                this.audio.init();
                const enabled = !this.audio.enabled;
                this.audio.setEnabled(enabled);
                btnAudio.classList.toggle('active', enabled);
                btnAudio.innerHTML = enabled ? '<span class="icon">🔊</span> Sound On' : '<span class="icon">🔇</span> Sound Off';
            });
        }

        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => {
                this.audio.setVolume(parseFloat(e.target.value));
            });
        }

        if (btnFullscreen) {
            btnFullscreen.addEventListener('click', () => {
                const monitor = document.getElementById('monitor-frame');
                if (!document.fullscreenElement) {
                    if (monitor.requestFullscreen) monitor.requestFullscreen();
                } else {
                    if (document.exitFullscreen) document.exitFullscreen();
                }
            });
        }

        // Paste Code Modal
        const pasteModal = document.getElementById('paste-modal');
        const pasteTextarea = document.getElementById('paste-textarea');
        const btnSubmitPaste = document.getElementById('btn-submit-paste');
        const btnClosePaste = document.getElementById('btn-close-paste');

        if (btnPaste) {
            btnPaste.addEventListener('click', () => {
                pasteModal.classList.remove('hidden');
                pasteTextarea.focus();
            });
        }

        if (btnClosePaste) {
            btnClosePaste.addEventListener('click', () => {
                pasteModal.classList.add('hidden');
            });
        }

        if (btnSubmitPaste) {
            btnSubmitPaste.addEventListener('click', () => {
                const text = pasteTextarea.value;
                if (text) {
                    this.keyboard.pasteText(text);
                }
                pasteModal.classList.add('hidden');
                pasteTextarea.value = '';
            });
        }

        // Disk Controller UI & Drive Event Listeners
        this.diskController.onDriveStateChange = (state) => {
            this.updateDriveUI(state);
        };

        this.initDiskUI(1);
        this.initDiskUI(2);

        // Global Drag & Drop for .dsk files onto the screen
        window.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        window.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                this.loadDiskFromFile(1, file);
            }
        });

        // Debugger Modal & Controls
        if (btnDebug) {
            const debugPanel = document.getElementById('debug-panel');
            btnDebug.addEventListener('click', () => {
                debugPanel.classList.toggle('hidden');
                if (!debugPanel.classList.contains('hidden')) {
                    this.updateDebuggerUI();
                }
            });
        }

        this.initDebuggerControls();

        // Canvas Click Focus & Audio Resume
        this.canvas.addEventListener('click', () => {
            this.audio.init();
            this.audio.resume();
        });

        // Initial drive UI update
        this.diskController.notifyState();
    }

    initDiskUI(driveNum) {
        const selectBuiltin = document.getElementById(`drive${driveNum}-select`);
        const fileInput = document.getElementById(`drive${driveNum}-file`);
        const btnEject = document.getElementById(`drive${driveNum}-eject`);
        const btnSave = document.getElementById(`drive${driveNum}-save`);

        if (selectBuiltin) {
            // Populate builtin options
            selectBuiltin.innerHTML = '<option value="">-- Choose Built-in Disk --</option>';
            BUILTIN_DISKS.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.id;
                opt.textContent = d.name;
                selectBuiltin.appendChild(opt);
            });

            if (driveNum === 1) {
                selectBuiltin.value = 'dos33';
            }

            selectBuiltin.addEventListener('change', async (e) => {
                const diskId = e.target.value;
                if (!diskId) return;

                const item = BUILTIN_DISKS.find(d => d.id === diskId);
                if (item) {
                    if (item.data) {
                        this.diskController.loadDisk(driveNum, item.data, item.name);
                        this.rebootAndBoot();
                    } else if (item.path) {
                        try {
                            const resp = await fetch(item.path);
                            const buf = await resp.arrayBuffer();
                            this.diskController.loadDisk(driveNum, new Uint8Array(buf), item.name);
                            this.rebootAndBoot();
                        } catch (err) {
                            console.error('Failed to load disk file:', err);
                            alert('Failed to load disk: ' + item.name);
                        }
                    }
                }
            });
        }

        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    this.loadDiskFromFile(driveNum, e.target.files[0]);
                }
            });
        }

        if (btnEject) {
            btnEject.addEventListener('click', () => {
                this.diskController.ejectDisk(driveNum);
                if (selectBuiltin) selectBuiltin.value = '';
            });
        }

        if (btnSave) {
            btnSave.addEventListener('click', () => {
                const drive = this.diskController.drives[driveNum - 1];
                if (drive && drive.hasDisk) {
                    const raw = drive.getRawData();
                    const blob = new Blob([raw], { type: 'application/octet-stream' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = (drive.name.replace(/[^a-zA-Z0-9_-]/g, '_') || `drive${driveNum}`) + '.dsk';
                    a.click();
                    URL.revokeObjectURL(url);
                }
            });
        }
    }

    loadDiskFromFile(driveNum, file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            if (data.length >= 143360) {
                this.diskController.loadDisk(driveNum, data, file.name);
                this.rebootAndBoot();
            } else {
                alert(`Error: ${file.name} is ${data.length} bytes. Standard Apple II .dsk is 143,360 bytes.`);
            }
        };
        reader.readAsArrayBuffer(file);
    }

    rebootAndBoot() {
        this.powerOn();
        if (!this.running) {
            const btnPlay = document.getElementById('btn-play');
            this.start();
            if (btnPlay) btnPlay.innerHTML = '<span class="icon">⏸</span> Pause';
        }
    }

    updateDriveUI(state) {
        // Drive 1 LED & Info
        const led1 = document.getElementById('drive1-led');
        const info1 = document.getElementById('drive1-info');
        if (led1) led1.classList.toggle('active', state.drive1.active);
        if (info1) {
            info1.textContent = state.drive1.loaded ?
                `[Trk ${state.drive1.track.toString().padStart(2, '0')}] ${state.drive1.name}` :
                '(No Disk)';
        }

        // Drive 2 LED & Info
        const led2 = document.getElementById('drive2-led');
        const info2 = document.getElementById('drive2-info');
        if (led2) led2.classList.toggle('active', state.drive2.active);
        if (info2) {
            info2.textContent = state.drive2.loaded ?
                `[Trk ${state.drive2.track.toString().padStart(2, '0')}] ${state.drive2.name}` :
                '(No Disk)';
        }
    }

    initDebuggerControls() {
        const btnStep = document.getElementById('dbg-btn-step');
        const btnGo = document.getElementById('dbg-btn-go');
        const inputPc = document.getElementById('dbg-input-pc');
        const inputBp = document.getElementById('dbg-input-bp');
        const btnAddBp = document.getElementById('dbg-btn-addbp');
        const btnClearBp = document.getElementById('dbg-btn-clearbp');

        if (btnStep) {
            btnStep.addEventListener('click', () => {
                this.pause();
                this.stepSingleInstruction();
            });
        }

        if (btnGo) {
            btnGo.addEventListener('click', () => {
                this.start();
            });
        }

        if (inputPc) {
            inputPc.addEventListener('change', (e) => {
                const val = parseInt(e.target.value, 16);
                if (!isNaN(val)) {
                    this.cpu.pc = val & 0xFFFF;
                    this.updateDebuggerUI();
                }
            });
        }

        if (btnAddBp && inputBp) {
            btnAddBp.addEventListener('click', () => {
                const val = parseInt(inputBp.value, 16);
                if (!isNaN(val)) {
                    this.debugger.breakpoints.add(val & 0xFFFF);
                    inputBp.value = '';
                    this.updateDebuggerUI();
                }
            });
        }

        if (btnClearBp) {
            btnClearBp.addEventListener('click', () => {
                this.debugger.breakpoints.clear();
                this.updateDebuggerUI();
            });
        }
    }

    updateDebuggerUI() {
        const state = this.cpu.getState();

        // Registers
        const elRegs = document.getElementById('dbg-regs');
        if (elRegs) {
            elRegs.innerHTML = `
                <div><strong>PC:</strong> $${this.debugger.hex4(state.pc)}</div>
                <div><strong>A:</strong>  $${this.debugger.hex2(state.a)} (${state.a})</div>
                <div><strong>X:</strong>  $${this.debugger.hex2(state.x)}</div>
                <div><strong>Y:</strong>  $${this.debugger.hex2(state.y)}</div>
                <div><strong>SP:</strong> $01${this.debugger.hex2(state.sp)}</div>
                <div><strong>P:</strong>  $${this.debugger.hex2(state.p)}</div>
                <div class="dbg-flags">
                    <span class="${state.flags.N ? 'flag-on' : ''}">N</span>
                    <span class="${state.flags.V ? 'flag-on' : ''}">V</span>
                    <span class="flag-on">-</span>
                    <span class="${state.flags.B ? 'flag-on' : ''}">B</span>
                    <span class="${state.flags.D ? 'flag-on' : ''}">D</span>
                    <span class="${state.flags.I ? 'flag-on' : ''}">I</span>
                    <span class="${state.flags.Z ? 'flag-on' : ''}">Z</span>
                    <span class="${state.flags.C ? 'flag-on' : ''}">C</span>
                </div>
            `;
        }

        // Disassembly
        const elDisasm = document.getElementById('dbg-disasm');
        if (elDisasm) {
            const lines = this.debugger.disassembleRange(state.pc, 12);
            elDisasm.innerHTML = lines.map(l => `
                <div class="disasm-line ${l.isPC ? 'current-pc' : ''}">
                    <span class="bp-marker">${l.hasBreakpoint ? '●' : ' '}</span>
                    <span>${l.text}</span>
                </div>
            `).join('');
        }

        // Memory Dump (Zero Page & Stack)
        const elMem = document.getElementById('dbg-mem');
        if (elMem) {
            const dump = this.debugger.getMemoryDump(0x0000, 8);
            elMem.innerHTML = dump.map(d => `
                <div class="mem-line">
                    <span class="mem-addr">$${d.addr}:</span>
                    <span class="mem-hex">${d.hex}</span>
                    <span class="mem-ascii">${d.ascii}</span>
                </div>
            `).join('');
        }
    }
}

// Automatically instantiate and launch on page load
window.addEventListener('DOMContentLoaded', () => {
    window.apple2 = new Apple2Emulator();
    window.apple2.start();
});
