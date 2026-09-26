// Apple II Keyboard Controller & Virtual Vintage Keyboard
// Maps modern keyboard events to Apple II ASCII codes, manages modifier keys,
// supports clipboard text auto-typing, and renders an interactive on-screen keyboard.

export class KeyboardManager {
    constructor(mmu, onResetCallback) {
        this.mmu = mmu;
        this.onReset = onResetCallback;

        this.ctrlDown = false;
        this.shiftDown = false;

        // Auto-typing queue for pasted BASIC code
        this.typeQueue = [];
        this.typeTimer = null;

        this.initEventListeners();
    }

    initEventListeners() {
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));
    }

    handleKeyDown(e) {
        // Track modifiers
        if (e.key === 'Control') { this.ctrlDown = true; return; }
        if (e.key === 'Shift') { this.shiftDown = true; return; }
        if (e.key === 'Alt') {
            if (e.location === 1) this.mmu.button0 = true; // Left Alt = Open Apple
            else this.mmu.button1 = true;                   // Right Alt = Closed Apple
            return;
        }

        // Check for Reset (Ctrl + Break / Ctrl + Esc / F12)
        if ((e.ctrlKey && e.key === 'Escape') || e.key === 'F12') {
            e.preventDefault();
            if (this.onReset) this.onReset();
            return;
        }

        // Prevent browser scrolling on arrow keys and space when canvas has focus
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
            const activeTag = document.activeElement ? document.activeElement.tagName : '';
            if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
                e.preventDefault();
            }
        }

        const ascii = this.translateKeyToAscii(e);
        if (ascii !== null) {
            this.sendKey(ascii);
        }
    }

    handleKeyUp(e) {
        if (e.key === 'Control') this.ctrlDown = false;
        if (e.key === 'Shift') this.shiftDown = false;
        if (e.key === 'Alt') {
            this.mmu.button0 = false;
            this.mmu.button1 = false;
        }
    }

    translateKeyToAscii(e) {
        const key = e.key;

        // Navigation & Control keys
        if (key === 'Enter') return 0x0D;       // Apple II Return
        if (key === 'Backspace') return 0x08;   // Apple II Left Arrow / Backspace
        if (key === 'Delete') return 0x08;
        if (key === 'Escape') return 0x1B;      // ESC
        if (key === 'Tab') return 0x09;
        if (key === 'ArrowLeft') return 0x08;   // Left Arrow
        if (key === 'ArrowRight') return 0x15;  // Right Arrow (Ctrl-U)
        if (key === 'ArrowUp') return 0x0B;     // Up Arrow
        if (key === 'ArrowDown') return 0x0A;   // Down Arrow

        // Control characters
        if (e.ctrlKey) {
            const upper = key.toUpperCase();
            if (upper.length === 1 && upper >= 'A' && upper <= 'Z') {
                return upper.charCodeAt(0) - 0x40; // Ctrl+A = 1, Ctrl+C = 3, etc.
            }
        }

        // Single printable characters
        if (key.length === 1) {
            let code = key.charCodeAt(0);

            // Apple II / II+ is uppercase only: convert 'a'..'z' to 'A'..'Z'
            if (code >= 0x61 && code <= 0x7A) {
                code -= 0x20;
            }

            return code;
        }

        return null;
    }

    sendKey(ascii) {
        this.mmu.setKey(ascii);
    }

    // Auto-type pasted text (e.g. Applesoft BASIC programs)
    pasteText(text) {
        if (!text) return;

        // Convert CRLF to CR
        const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        for (let i = 0; i < clean.length; i++) {
            let charCode = clean.charCodeAt(i);
            if (charCode === 10) { // LF -> CR
                charCode = 13;
            }
            if (charCode >= 0x61 && charCode <= 0x7A) {
                charCode -= 0x20; // Uppercase
            }
            this.typeQueue.push(charCode);
        }

        if (!this.typeTimer) {
            this.processTypeQueue();
        }
    }

    processTypeQueue() {
        if (this.typeQueue.length === 0) {
            this.typeTimer = null;
            return;
        }

        // Only send next character if previous strobe was cleared
        if ((this.mmu.keyData & 0x80) === 0) {
            const nextKey = this.typeQueue.shift();
            this.sendKey(nextKey);
        }

        // Fast typing rate: ~30ms per character
        this.typeTimer = setTimeout(() => this.processTypeQueue(), 30);
    }

    // Render interactive virtual keyboard into a DOM container
    renderVirtualKeyboard(container) {
        container.innerHTML = '';

        const layout = [
            // Row 1
            [
                { label: 'ESC', code: 0x1B, w: 'key-esc' },
                { label: '1', code: 0x31 }, { label: '2', code: 0x32 }, { label: '3', code: 0x33 },
                { label: '4', code: 0x34 }, { label: '5', code: 0x35 }, { label: '6', code: 0x36 },
                { label: '7', code: 0x37 }, { label: '8', code: 0x38 }, { label: '9', code: 0x39 },
                { label: '0', code: 0x30 }, { label: ':', code: 0x3A }, { label: '-', code: 0x2D },
                { label: 'RESET', action: 'reset', w: 'key-reset' }
            ],
            // Row 2
            [
                { label: 'TAB', code: 0x09, w: 'key-tab' },
                { label: 'Q', code: 0x51 }, { label: 'W', code: 0x57 }, { label: 'E', code: 0x45 },
                { label: 'R', code: 0x52 }, { label: 'T', code: 0x54 }, { label: 'Y', code: 0x59 },
                { label: 'U', code: 0x55 }, { label: 'I', code: 0x49 }, { label: 'O', code: 0x4F },
                { label: 'P', code: 0x50 }, { label: 'REPT', action: 'repeat', w: 'key-fn' },
                { label: 'RETURN', code: 0x0D, w: 'key-return' }
            ],
            // Row 3
            [
                { label: 'CTRL', action: 'ctrl', w: 'key-ctrl' },
                { label: 'A', code: 0x41 }, { label: 'S', code: 0x53 }, { label: 'D', code: 0x44 },
                { label: 'F', code: 0x46 }, { label: 'G', code: 0x47 }, { label: 'H', code: 0x48 },
                { label: 'J', code: 0x4A }, { label: 'K', code: 0x4B }, { label: 'L', code: 0x4C },
                { label: ';', code: 0x3B }, { label: '←', code: 0x08, w: 'key-arrow' },
                { label: '→', code: 0x15, w: 'key-arrow' }
            ],
            // Row 4
            [
                { label: 'SHIFT', action: 'shift', w: 'key-shift' },
                { label: 'Z', code: 0x5A }, { label: 'X', code: 0x58 }, { label: 'C', code: 0x43 },
                { label: 'V', code: 0x56 }, { label: 'B', code: 0x42 }, { label: 'N', code: 0x4E },
                { label: 'M', code: 0x4D }, { label: ',', code: 0x2C }, { label: '.', code: 0x2E },
                { label: '/', code: 0x2F },
                { label: 'SHIFT', action: 'shift', w: 'key-shift' }
            ],
            // Row 5
            [
                { label: 'SPACE', code: 0x20, w: 'key-space' }
            ]
        ];

        layout.forEach(rowDef => {
            const rowEl = document.createElement('div');
            rowEl.className = 'kb-row';

            rowDef.forEach(k => {
                const btn = document.createElement('button');
                btn.className = `retro-key ${k.w || ''}`;
                btn.textContent = k.label;

                btn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    if (k.action === 'reset') {
                        if (this.onReset) this.onReset();
                    } else if (k.action === 'ctrl') {
                        this.ctrlDown = !this.ctrlDown;
                        btn.classList.toggle('active', this.ctrlDown);
                    } else if (k.action === 'shift') {
                        this.shiftDown = !this.shiftDown;
                        btn.classList.toggle('active', this.shiftDown);
                    } else if (k.code !== undefined) {
                        let code = k.code;
                        if (this.ctrlDown && code >= 0x41 && code <= 0x5A) {
                            code = code - 0x40;
                        }
                        this.sendKey(code);
                    }
                });

                rowEl.appendChild(btn);
            });

            container.appendChild(rowEl);
        });
    }
}
