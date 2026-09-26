// Apple II Memory Management Unit (MMU)
// Handles 48KB base RAM, 16KB Language Card expansion RAM,
// hardware softswitches ($C000-$C0FF), peripheral slots (Slot 6 Disk II),
// and Apple II+ System ROM ($D000-$FFFF).

export class MMU {
    constructor() {
        // 48KB Main RAM ($0000 - $BFFF)
        this.ram = new Uint8Array(0xC000);

        // 16KB Language Card RAM:
        // Bank 1 ($D000-$DFFF, 4KB)
        this.lcBank1 = new Uint8Array(0x1000);
        // Bank 2 ($D000-$DFFF, 4KB)
        this.lcBank2 = new Uint8Array(0x1000);
        // High RAM ($E000-$FFFF, 8KB)
        this.lcHigh = new Uint8Array(0x2000);

        // ROMs (populated from roms.js)
        this.systemRom = new Uint8Array(0x3000); // 12KB ($D000-$FFFF)
        this.slot6Rom = new Uint8Array(0x0100);  // 256B ($C600-$C6FF)

        // Softswitches & Video State
        this.switches = {
            text: true,      // true: Text mode, false: Graphics
            mixed: false,    // true: 4 lines of text at bottom in graphics
            page2: false,    // true: Page 2 ($0800 text / $4000 hgr), false: Page 1
            hires: false     // true: Hi-Res ($2000/$4000), false: Lo-Res
        };

        // Keyboard latch ($C000) & strobe ($C010)
        this.keyData = 0;       // Bit 7 = 1 if key ready, Bits 0-6 = ASCII

        // Pushbuttons ($C061, $C062) & Paddles ($C064, $C065, $C070)
        this.button0 = false;   // Open Apple / Gamepad btn 0
        this.button1 = false;   // Closed Apple / Gamepad btn 1
        this.paddle0 = 0;       // Paddle 0 position (0..255)
        this.paddle1 = 0;       // Paddle 1 position (0..255)
        this.paddleTimer0 = 0;  // Analog countdown
        this.paddleTimer1 = 0;

        // Language Card state ($C080-$C08F)
        this.lcBank2Selected = false; // true = Bank 2 ($D000), false = Bank 1
        this.lcReadRam = false;       // true = Read LC RAM, false = Read ROM
        this.lcWriteRam = false;      // true = Write LC RAM enabled
        this.lcPreWrite = false;      // Write enable requires two reads

        // Peripherals
        this.diskController = null;
        this.audio = null;
    }

    setSystemRom(romBytes) {
        this.systemRom.set(romBytes.subarray(0, 0x3000));
    }

    setSlot6Rom(romBytes) {
        this.slot6Rom.set(romBytes.subarray(0, 0x0100));
    }

    reset() {
        // Reset softswitches to default Apple II power-on state
        this.switches.text = true;
        this.switches.mixed = false;
        this.switches.page2 = false;
        this.switches.hires = false;

        this.keyData = 0;
        this.lcBank2Selected = false;
        this.lcReadRam = false;
        this.lcWriteRam = false;
        this.lcPreWrite = false;
    }

    // Key input from keyboard subsystem
    setKey(asciiCode) {
        // Apple II keyboard latches bit 7 set on key down
        this.keyData = (asciiCode & 0x7F) | 0x80;
    }

    clearKeyStrobe() {
        this.keyData &= 0x7F;
    }

    triggerPaddles() {
        // Paddle countdown based on analog resistance (~0-3000 CPU cycles)
        this.paddleTimer0 = Math.floor(this.paddle0 * 11);
        this.paddleTimer1 = Math.floor(this.paddle1 * 11);
    }

    updatePaddleTimers(cycles) {
        if (this.paddleTimer0 > 0) {
            this.paddleTimer0 = Math.max(0, this.paddleTimer0 - cycles);
        }
        if (this.paddleTimer1 > 0) {
            this.paddleTimer1 = Math.max(0, this.paddleTimer1 - cycles);
        }
    }

    // Memory Read
    read(addr) {
        addr &= 0xFFFF;

        // 1. Base RAM ($0000 - $BFFF)
        if (addr < 0xC000) {
            return this.ram[addr];
        }

        // 2. Hardware I/O & Softswitches ($C000 - $C0FF)
        if (addr < 0xC100) {
            return this.readIO(addr);
        }

        // 3. Slot ROMs ($C100 - $C7FF)
        if (addr < 0xC800) {
            // Slot 6: Disk II Boot ROM ($C600 - $C6FF)
            if (addr >= 0xC600 && addr <= 0xC6FF) {
                return this.slot6Rom[addr - 0xC600];
            }
            return 0xFF; // Unpopulated slot
        }

        // 4. Expansion ROM ($C800 - $CFFF)
        if (addr < 0xD000) {
            return 0xFF;
        }

        // 5. High Memory ($D000 - $FFFF): ROM or Language Card RAM
        if (this.lcReadRam) {
            if (addr < 0xE000) {
                // $D000 - $DFFF
                const offset = addr - 0xD000;
                return this.lcBank2Selected ? this.lcBank2[offset] : this.lcBank1[offset];
            } else {
                // $E000 - $FFFF
                return this.lcHigh[addr - 0xE000];
            }
        } else {
            // Read from System ROM ($D000 - $FFFF)
            return this.systemRom[addr - 0xD000];
        }
    }

    // Memory Write
    write(addr, val) {
        addr &= 0xFFFF;
        val &= 0xFF;

        // 1. Base RAM ($0000 - $BFFF)
        if (addr < 0xC000) {
            this.ram[addr] = val;
            return;
        }

        // 2. Hardware I/O & Softswitches ($C000 - $C0FF)
        if (addr < 0xC100) {
            this.writeIO(addr, val);
            return;
        }

        // 3. Slot ROMs & Expansion ROM ($C100 - $CFFF) - read only
        if (addr < 0xD000) {
            return;
        }

        // 4. High Memory ($D000 - $FFFF): Language Card RAM Write
        if (this.lcWriteRam) {
            if (addr < 0xE000) {
                const offset = addr - 0xD000;
                if (this.lcBank2Selected) {
                    this.lcBank2[offset] = val;
                } else {
                    this.lcBank1[offset] = val;
                }
            } else {
                this.lcHigh[addr - 0xE000] = val;
            }
        }
    }

    readIO(addr) {
        // Floating bus value default
        let res = 0x00;

        switch (addr) {
            // Keyboard
            case 0xC000:
                return this.keyData;

            case 0xC010:
                this.clearKeyStrobe();
                return this.keyData;

            // Cassette
            case 0xC020:
                return 0x00;

            // Speaker toggle
            case 0xC030:
                if (this.audio) {
                    this.audio.click();
                }
                return 0x00;

            // Video Switches Read
            case 0xC050: this.switches.text = false; return 0x00;
            case 0xC051: this.switches.text = true; return 0x00;
            case 0xC052: this.switches.mixed = false; return 0x00;
            case 0xC053: this.switches.mixed = true; return 0x00;
            case 0xC054: this.switches.page2 = false; return 0x00;
            case 0xC055: this.switches.page2 = true; return 0x00;
            case 0xC056: this.switches.hires = false; return 0x00;
            case 0xC057: this.switches.hires = true; return 0x00;

            // Game Buttons
            case 0xC061:
                return this.button0 ? 0x80 : 0x00;
            case 0xC062:
                return this.button1 ? 0x80 : 0x00;

            // Game Paddles
            case 0xC064:
                return this.paddleTimer0 > 0 ? 0x80 : 0x00;
            case 0xC065:
                return this.paddleTimer1 > 0 ? 0x80 : 0x00;

            // Trigger Paddle Timers
            case 0xC070:
                this.triggerPaddles();
                return 0x00;
        }

        // Language Card ($C080 - $C08F)
        if (addr >= 0xC080 && addr <= 0xC08F) {
            this.handleLanguageCard(addr, true);
            return 0x00;
        }

        // Slot 6 Disk II Softswitches ($C0E0 - $C0EF)
        if (addr >= 0xC0E0 && addr <= 0xC0EF) {
            if (this.diskController) {
                return this.diskController.access(addr & 0x0F, false, 0);
            }
            return 0x00;
        }

        return res;
    }

    writeIO(addr, val) {
        switch (addr) {
            case 0xC010:
                this.clearKeyStrobe();
                break;

            case 0xC030:
                if (this.audio) {
                    this.audio.click();
                }
                break;

            // Video Switches Write
            case 0xC050: this.switches.text = false; break;
            case 0xC051: this.switches.text = true; break;
            case 0xC052: this.switches.mixed = false; break;
            case 0xC053: this.switches.mixed = true; break;
            case 0xC054: this.switches.page2 = false; break;
            case 0xC055: this.switches.page2 = true; break;
            case 0xC056: this.switches.hires = false; break;
            case 0xC057: this.switches.hires = true; break;

            case 0xC070:
                this.triggerPaddles();
                break;
        }

        // Language Card ($C080 - $C08F)
        if (addr >= 0xC080 && addr <= 0xC08F) {
            this.handleLanguageCard(addr, false);
            return;
        }

        // Slot 6 Disk II Softswitches ($C0E0 - $C0EF)
        if (addr >= 0xC0E0 && addr <= 0xC0EF) {
            if (this.diskController) {
                this.diskController.access(addr & 0x0F, true, val);
            }
        }
    }

    handleLanguageCard(addr, isRead) {
        // Address bits:
        // A3 (0x08): 0 = Bank 1, 1 = Bank 2
        // A1 (0x02): 0 = Read ROM, 1 = Read RAM
        // A0 (0x01): Write enable (needs two successive reads if write enabled)
        const bank2 = !!(addr & 0x08);
        const readRam = !!(addr & 0x02);
        const writeEnableRequest = !!(addr & 0x01);

        this.lcBank2Selected = bank2;
        this.lcReadRam = readRam;

        if (writeEnableRequest) {
            if (isRead) {
                if (this.lcPreWrite) {
                    this.lcWriteRam = true;
                } else {
                    this.lcPreWrite = true;
                }
            }
        } else {
            this.lcWriteRam = false;
            this.lcPreWrite = false;
        }
    }
}
