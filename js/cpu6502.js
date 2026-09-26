// MOS 6502 CPU Core
// Accurate NMOS 6502 implementation with full instruction set, addressing modes,
// BCD decimal arithmetic, stack management, interrupts, and cycle counting.

export class CPU6502 {
    constructor(mmu) {
        this.mmu = mmu;

        // Registers
        this.a = 0;      // Accumulator
        this.x = 0;      // X index
        this.y = 0;      // Y index
        this.sp = 0xFD;  // Stack Pointer
        this.pc = 0;     // Program Counter
        this.p = 0x24;   // Processor Status (Bit 5 unused = 1, Bit 2 IRQ disable = 1)

        // Cycle counter
        this.cycles = 0;

        // Interrupt requests
        this.nmiPending = false;
        this.irqPending = false;

        // Status register bit masks
        this.FLAG_C = 0x01; // Carry
        this.FLAG_Z = 0x02; // Zero
        this.FLAG_I = 0x04; // Interrupt Disable
        this.FLAG_D = 0x08; // Decimal Mode
        this.FLAG_B = 0x10; // Break
        this.FLAG_U = 0x20; // Unused (always 1 in status register)
        this.FLAG_V = 0x40; // Overflow
        this.FLAG_N = 0x80; // Negative

        this.initOpcodeTable();
    }

    reset() {
        this.sp = 0xFD;
        this.p = 0x24 | this.FLAG_U | this.FLAG_I; // I=1, U=1
        this.a = 0;
        this.x = 0;
        this.y = 0;
        this.nmiPending = false;
        this.irqPending = false;
        // Read reset vector from $FFFC-$FFFD
        const lo = this.mmu.read(0xFFFC);
        const hi = this.mmu.read(0xFFFD);
        this.pc = (hi << 8) | lo;
        this.cycles = 7;
    }

    nmi() {
        this.nmiPending = true;
    }

    irq() {
        this.irqPending = true;
    }

    push(val) {
        this.mmu.write(0x0100 | this.sp, val & 0xFF);
        this.sp = (this.sp - 1) & 0xFF;
    }

    pull() {
        this.sp = (this.sp + 1) & 0xFF;
        return this.mmu.read(0x0100 | this.sp);
    }

    push16(val) {
        this.push((val >> 8) & 0xFF);
        this.push(val & 0xFF);
    }

    pull16() {
        const lo = this.pull();
        const hi = this.pull();
        return (hi << 8) | lo;
    }

    setZN(val) {
        val &= 0xFF;
        if (val === 0) {
            this.p |= this.FLAG_Z;
        } else {
            this.p &= ~this.FLAG_Z;
        }
        if (val & 0x80) {
            this.p |= this.FLAG_N;
        } else {
            this.p &= ~this.FLAG_N;
        }
    }

    step() {
        // Handle NMI
        if (this.nmiPending) {
            this.nmiPending = false;
            this.push16(this.pc);
            this.push((this.p | this.FLAG_U) & ~this.FLAG_B);
            this.p |= this.FLAG_I;
            const lo = this.mmu.read(0xFFFA);
            const hi = this.mmu.read(0xFFFB);
            this.pc = (hi << 8) | lo;
            this.cycles += 7;
            return 7;
        }

        // Handle IRQ
        if (this.irqPending && !(this.p & this.FLAG_I)) {
            this.push16(this.pc);
            this.push((this.p | this.FLAG_U) & ~this.FLAG_B);
            this.p |= this.FLAG_I;
            const lo = this.mmu.read(0xFFFE);
            const hi = this.mmu.read(0xFFFF);
            this.pc = (hi << 8) | lo;
            this.cycles += 7;
            return 7;
        }

        const opcode = this.mmu.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;

        const op = this.opcodes[opcode];
        if (!op) {
            // NOP for unimplemented / unofficial opcodes
            this.cycles += 2;
            return 2;
        }

        const startCycles = this.cycles;
        op.fn.call(this);
        const elapsed = (this.cycles - startCycles) + op.cycles;
        this.cycles = startCycles + elapsed;
        return elapsed;
    }

    // Addressing Modes
    addrIMM() {
        const addr = this.pc;
        this.pc = (this.pc + 1) & 0xFFFF;
        return addr;
    }

    addrZP() {
        const addr = this.mmu.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        return addr;
    }

    addrZPX() {
        const zp = this.mmu.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        return (zp + this.x) & 0xFF;
    }

    addrZPY() {
        const zp = this.mmu.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        return (zp + this.y) & 0xFF;
    }

    addrABS() {
        const lo = this.mmu.read(this.pc);
        const hi = this.mmu.read((this.pc + 1) & 0xFFFF);
        this.pc = (this.pc + 2) & 0xFFFF;
        return (hi << 8) | lo;
    }

    addrABSX(pageExtra = true) {
        const lo = this.mmu.read(this.pc);
        const hi = this.mmu.read((this.pc + 1) & 0xFFFF);
        this.pc = (this.pc + 2) & 0xFFFF;
        const base = (hi << 8) | lo;
        const addr = (base + this.x) & 0xFFFF;
        if (pageExtra && (base & 0xFF00) !== (addr & 0xFF00)) {
            this.cycles += 1;
        }
        return addr;
    }

    addrABSY(pageExtra = true) {
        const lo = this.mmu.read(this.pc);
        const hi = this.mmu.read((this.pc + 1) & 0xFFFF);
        this.pc = (this.pc + 2) & 0xFFFF;
        const base = (hi << 8) | lo;
        const addr = (base + this.y) & 0xFFFF;
        if (pageExtra && (base & 0xFF00) !== (addr & 0xFF00)) {
            this.cycles += 1;
        }
        return addr;
    }

    addrIND() {
        const lo = this.mmu.read(this.pc);
        const hi = this.mmu.read((this.pc + 1) & 0xFFFF);
        this.pc = (this.pc + 2) & 0xFFFF;
        const ptr = (hi << 8) | lo;
        // 6502 page boundary hardware bug: if lo is 0xFF, high byte fetched from (ptr & 0xFF00)
        const effLo = this.mmu.read(ptr);
        const effHi = this.mmu.read((ptr & 0xFF00) | ((ptr + 1) & 0x00FF));
        return (effHi << 8) | effLo;
    }

    addrINDX() {
        const zp = this.mmu.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const ptr = (zp + this.x) & 0xFF;
        const lo = this.mmu.read(ptr);
        const hi = this.mmu.read((ptr + 1) & 0xFF);
        return (hi << 8) | lo;
    }

    addrINDY(pageExtra = true) {
        const zp = this.mmu.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const lo = this.mmu.read(zp);
        const hi = this.mmu.read((zp + 1) & 0xFF);
        const base = (hi << 8) | lo;
        const addr = (base + this.y) & 0xFFFF;
        if (pageExtra && (base & 0xFF00) !== (addr & 0xFF00)) {
            this.cycles += 1;
        }
        return addr;
    }

    // Branch helper
    branch(condition) {
        const offset = this.mmu.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        if (condition) {
            this.cycles += 1;
            const signedOffset = offset > 127 ? offset - 256 : offset;
            const newPC = (this.pc + signedOffset) & 0xFFFF;
            if ((this.pc & 0xFF00) !== (newPC & 0xFF00)) {
                this.cycles += 1;
            }
            this.pc = newPC;
        }
    }

    // Arithmetic helpers
    adc(val) {
        if (this.p & this.FLAG_D) {
            // NMOS 6502 Decimal Mode
            const c = (this.p & this.FLAG_C) ? 1 : 0;
            let al = (this.a & 0x0F) + (val & 0x0F) + c;
            let ah = (this.a >> 4) + (val >> 4);
            if (al > 9) {
                al += 6;
                ah += 1;
            }
            const z = ((this.a + val + c) & 0xFF) === 0;
            const n = (ah & 0x08) !== 0;
            const v = (!((this.a ^ val) & 0x80) && ((this.a ^ (ah << 4)) & 0x80)) !== 0;
            if (ah > 9) {
                ah += 6;
            }
            const carry = ah > 15;
            this.a = ((ah << 4) | (al & 0x0F)) & 0xFF;

            if (carry) this.p |= this.FLAG_C; else this.p &= ~this.FLAG_C;
            if (z) this.p |= this.FLAG_Z; else this.p &= ~this.FLAG_Z;
            if (v) this.p |= this.FLAG_V; else this.p &= ~this.FLAG_V;
            if (n) this.p |= this.FLAG_N; else this.p &= ~this.FLAG_N;
        } else {
            // Binary Mode
            const c = (this.p & this.FLAG_C) ? 1 : 0;
            const sum = this.a + val + c;
            const carry = sum > 0xFF;
            const overflow = (!((this.a ^ val) & 0x80) && ((this.a ^ sum) & 0x80)) !== 0;
            this.a = sum & 0xFF;
            this.setZN(this.a);
            if (carry) this.p |= this.FLAG_C; else this.p &= ~this.FLAG_C;
            if (overflow) this.p |= this.FLAG_V; else this.p &= ~this.FLAG_V;
        }
    }

    sbc(val) {
        if (this.p & this.FLAG_D) {
            // NMOS 6502 Decimal Mode
            const c = (this.p & this.FLAG_C) ? 0 : 1; // Borrow = !C
            const diff = this.a - val - c;
            let al = (this.a & 0x0F) - (val & 0x0F) - c;
            let ah = (this.a >> 4) - (val >> 4);
            if (al < 0) {
                al -= 6;
                ah -= 1;
            }
            if (ah < 0) {
                ah -= 6;
            }
            const carry = diff >= 0;
            const z = (diff & 0xFF) === 0;
            const n = (diff & 0x80) !== 0;
            const v = (((this.a ^ diff) & 0x80) && ((this.a ^ val) & 0x80)) !== 0;
            this.a = diff & 0xFF;

            if (carry) this.p |= this.FLAG_C; else this.p &= ~this.FLAG_C;
            if (z) this.p |= this.FLAG_Z; else this.p &= ~this.FLAG_Z;
            if (v) this.p |= this.FLAG_V; else this.p &= ~this.FLAG_V;
            if (n) this.p |= this.FLAG_N; else this.p &= ~this.FLAG_N;
        } else {
            // Binary Mode: SBC(val) is identical to ADC(~val & 0xFF)
            const c = (this.p & this.FLAG_C) ? 1 : 0;
            const diff = this.a - val - (1 - c);
            const carry = diff >= 0;
            const overflow = (((this.a ^ diff) & 0x80) && ((this.a ^ val) & 0x80)) !== 0;
            this.a = diff & 0xFF;
            this.setZN(this.a);
            if (carry) this.p |= this.FLAG_C; else this.p &= ~this.FLAG_C;
            if (overflow) this.p |= this.FLAG_V; else this.p &= ~this.FLAG_V;
        }
    }

    cmp(reg, val) {
        const diff = reg - val;
        if (diff >= 0) this.p |= this.FLAG_C; else this.p &= ~this.FLAG_C;
        this.setZN(diff & 0xFF);
    }

    asl(val) {
        if (val & 0x80) this.p |= this.FLAG_C; else this.p &= ~this.FLAG_C;
        const res = (val << 1) & 0xFF;
        this.setZN(res);
        return res;
    }

    lsr(val) {
        if (val & 0x01) this.p |= this.FLAG_C; else this.p &= ~this.FLAG_C;
        const res = (val >> 1) & 0xFF;
        this.setZN(res);
        return res;
    }

    rol(val) {
        const oldC = (this.p & this.FLAG_C) ? 1 : 0;
        if (val & 0x80) this.p |= this.FLAG_C; else this.p &= ~this.FLAG_C;
        const res = ((val << 1) | oldC) & 0xFF;
        this.setZN(res);
        return res;
    }

    ror(val) {
        const oldC = (this.p & this.FLAG_C) ? 0x80 : 0;
        if (val & 0x01) this.p |= this.FLAG_C; else this.p &= ~this.FLAG_C;
        const res = ((val >> 1) | oldC) & 0xFF;
        this.setZN(res);
        return res;
    }

    initOpcodeTable() {
        this.opcodes = new Array(256);

        const def = (code, name, cycles, fn) => {
            this.opcodes[code] = { name, cycles, fn };
        };

        // Load & Store
        // LDA
        def(0xA9, "LDA #", 2, () => { this.a = this.mmu.read(this.addrIMM()); this.setZN(this.a); });
        def(0xA5, "LDA ZP", 3, () => { this.a = this.mmu.read(this.addrZP()); this.setZN(this.a); });
        def(0xB5, "LDA ZPX", 4, () => { this.a = this.mmu.read(this.addrZPX()); this.setZN(this.a); });
        def(0xAD, "LDA ABS", 4, () => { this.a = this.mmu.read(this.addrABS()); this.setZN(this.a); });
        def(0xBD, "LDA ABSX", 4, () => { this.a = this.mmu.read(this.addrABSX()); this.setZN(this.a); });
        def(0xB9, "LDA ABSY", 4, () => { this.a = this.mmu.read(this.addrABSY()); this.setZN(this.a); });
        def(0xA1, "LDA INDX", 6, () => { this.a = this.mmu.read(this.addrINDX()); this.setZN(this.a); });
        def(0xB1, "LDA INDY", 5, () => { this.a = this.mmu.read(this.addrINDY()); this.setZN(this.a); });

        // LDX
        def(0xA2, "LDX #", 2, () => { this.x = this.mmu.read(this.addrIMM()); this.setZN(this.x); });
        def(0xA6, "LDX ZP", 3, () => { this.x = this.mmu.read(this.addrZP()); this.setZN(this.x); });
        def(0xB6, "LDX ZPY", 4, () => { this.x = this.mmu.read(this.addrZPY()); this.setZN(this.x); });
        def(0xAE, "LDX ABS", 4, () => { this.x = this.mmu.read(this.addrABS()); this.setZN(this.x); });
        def(0xBE, "LDX ABSY", 4, () => { this.x = this.mmu.read(this.addrABSY()); this.setZN(this.x); });

        // LDY
        def(0xA0, "LDY #", 2, () => { this.y = this.mmu.read(this.addrIMM()); this.setZN(this.y); });
        def(0xA4, "LDY ZP", 3, () => { this.y = this.mmu.read(this.addrZP()); this.setZN(this.y); });
        def(0xB4, "LDY ZPX", 4, () => { this.y = this.mmu.read(this.addrZPX()); this.setZN(this.y); });
        def(0xAC, "LDY ABS", 4, () => { this.y = this.mmu.read(this.addrABS()); this.setZN(this.y); });
        def(0xBC, "LDY ABSX", 4, () => { this.y = this.mmu.read(this.addrABSX()); this.setZN(this.y); });

        // STA
        def(0x85, "STA ZP", 3, () => { this.mmu.write(this.addrZP(), this.a); });
        def(0x95, "STA ZPX", 4, () => { this.mmu.write(this.addrZPX(), this.a); });
        def(0x8D, "STA ABS", 4, () => { this.mmu.write(this.addrABS(), this.a); });
        def(0x9D, "STA ABSX", 5, () => { this.mmu.write(this.addrABSX(false), this.a); });
        def(0x99, "STA ABSY", 5, () => { this.mmu.write(this.addrABSY(false), this.a); });
        def(0x81, "STA INDX", 6, () => { this.mmu.write(this.addrINDX(), this.a); });
        def(0x91, "STA INDY", 6, () => { this.mmu.write(this.addrINDY(false), this.a); });

        // STX
        def(0x86, "STX ZP", 3, () => { this.mmu.write(this.addrZP(), this.x); });
        def(0x96, "STX ZPY", 4, () => { this.mmu.write(this.addrZPY(), this.x); });
        def(0x8E, "STX ABS", 4, () => { this.mmu.write(this.addrABS(), this.x); });

        // STY
        def(0x84, "STY ZP", 3, () => { this.mmu.write(this.addrZP(), this.y); });
        def(0x94, "STY ZPX", 4, () => { this.mmu.write(this.addrZPX(), this.y); });
        def(0x8C, "STY ABS", 4, () => { this.mmu.write(this.addrABS(), this.y); });

        // Transfers
        def(0xAA, "TAX", 2, () => { this.x = this.a; this.setZN(this.x); });
        def(0x8A, "TXA", 2, () => { this.a = this.x; this.setZN(this.a); });
        def(0xA8, "TAY", 2, () => { this.y = this.a; this.setZN(this.y); });
        def(0x98, "TYA", 2, () => { this.a = this.y; this.setZN(this.a); });
        def(0xBA, "TSX", 2, () => { this.x = this.sp; this.setZN(this.x); });
        def(0x9A, "TXS", 2, () => { this.sp = this.x; });

        // Stack
        def(0x48, "PHA", 3, () => { this.push(this.a); });
        def(0x68, "PLA", 4, () => { this.a = this.pull(); this.setZN(this.a); });
        def(0x08, "PHP", 3, () => { this.push(this.p | this.FLAG_B | this.FLAG_U); });
        def(0x28, "PLP", 4, () => { this.p = (this.pull() & ~this.FLAG_B) | this.FLAG_U; });

        // Logical
        // AND
        def(0x29, "AND #", 2, () => { this.a &= this.mmu.read(this.addrIMM()); this.setZN(this.a); });
        def(0x25, "AND ZP", 3, () => { this.a &= this.mmu.read(this.addrZP()); this.setZN(this.a); });
        def(0x35, "AND ZPX", 4, () => { this.a &= this.mmu.read(this.addrZPX()); this.setZN(this.a); });
        def(0x2D, "AND ABS", 4, () => { this.a &= this.mmu.read(this.addrABS()); this.setZN(this.a); });
        def(0x3D, "AND ABSX", 4, () => { this.a &= this.mmu.read(this.addrABSX()); this.setZN(this.a); });
        def(0x39, "AND ABSY", 4, () => { this.a &= this.mmu.read(this.addrABSY()); this.setZN(this.a); });
        def(0x21, "AND INDX", 6, () => { this.a &= this.mmu.read(this.addrINDX()); this.setZN(this.a); });
        def(0x31, "AND INDY", 5, () => { this.a &= this.mmu.read(this.addrINDY()); this.setZN(this.a); });

        // ORA
        def(0x09, "ORA #", 2, () => { this.a |= this.mmu.read(this.addrIMM()); this.setZN(this.a); });
        def(0x05, "ORA ZP", 3, () => { this.a |= this.mmu.read(this.addrZP()); this.setZN(this.a); });
        def(0x15, "ORA ZPX", 4, () => { this.a |= this.mmu.read(this.addrZPX()); this.setZN(this.a); });
        def(0x0D, "ORA ABS", 4, () => { this.a |= this.mmu.read(this.addrABS()); this.setZN(this.a); });
        def(0x1D, "ORA ABSX", 4, () => { this.a |= this.mmu.read(this.addrABSX()); this.setZN(this.a); });
        def(0x19, "ORA ABSY", 4, () => { this.a |= this.mmu.read(this.addrABSY()); this.setZN(this.a); });
        def(0x01, "ORA INDX", 6, () => { this.a |= this.mmu.read(this.addrINDX()); this.setZN(this.a); });
        def(0x11, "ORA INDY", 5, () => { this.a |= this.mmu.read(this.addrINDY()); this.setZN(this.a); });

        // EOR
        def(0x49, "EOR #", 2, () => { this.a ^= this.mmu.read(this.addrIMM()); this.setZN(this.a); });
        def(0x45, "EOR ZP", 3, () => { this.a ^= this.mmu.read(this.addrZP()); this.setZN(this.a); });
        def(0x55, "EOR ZPX", 4, () => { this.a ^= this.mmu.read(this.addrZPX()); this.setZN(this.a); });
        def(0x4D, "EOR ABS", 4, () => { this.a ^= this.mmu.read(this.addrABS()); this.setZN(this.a); });
        def(0x5D, "EOR ABSX", 4, () => { this.a ^= this.mmu.read(this.addrABSX()); this.setZN(this.a); });
        def(0x59, "EOR ABSY", 4, () => { this.a ^= this.mmu.read(this.addrABSY()); this.setZN(this.a); });
        def(0x41, "EOR INDX", 6, () => { this.a ^= this.mmu.read(this.addrINDX()); this.setZN(this.a); });
        def(0x51, "EOR INDY", 5, () => { this.a ^= this.mmu.read(this.addrINDY()); this.setZN(this.a); });

        // BIT
        def(0x24, "BIT ZP", 3, () => {
            const val = this.mmu.read(this.addrZP());
            if ((this.a & val) === 0) this.p |= this.FLAG_Z; else this.p &= ~this.FLAG_Z;
            this.p = (this.p & ~(this.FLAG_N | this.FLAG_V)) | (val & (this.FLAG_N | this.FLAG_V));
        });
        def(0x2C, "BIT ABS", 4, () => {
            const val = this.mmu.read(this.addrABS());
            if ((this.a & val) === 0) this.p |= this.FLAG_Z; else this.p &= ~this.FLAG_Z;
            this.p = (this.p & ~(this.FLAG_N | this.FLAG_V)) | (val & (this.FLAG_N | this.FLAG_V));
        });

        // Arithmetic
        // ADC
        def(0x69, "ADC #", 2, () => { this.adc(this.mmu.read(this.addrIMM())); });
        def(0x65, "ADC ZP", 3, () => { this.adc(this.mmu.read(this.addrZP())); });
        def(0x75, "ADC ZPX", 4, () => { this.adc(this.mmu.read(this.addrZPX())); });
        def(0x6D, "ADC ABS", 4, () => { this.adc(this.mmu.read(this.addrABS())); });
        def(0x7D, "ADC ABSX", 4, () => { this.adc(this.mmu.read(this.addrABSX())); });
        def(0x79, "ADC ABSY", 4, () => { this.adc(this.mmu.read(this.addrABSY())); });
        def(0x61, "ADC INDX", 6, () => { this.adc(this.mmu.read(this.addrINDX())); });
        def(0x71, "ADC INDY", 5, () => { this.adc(this.mmu.read(this.addrINDY())); });

        // SBC
        def(0xE9, "SBC #", 2, () => { this.sbc(this.mmu.read(this.addrIMM())); });
        def(0xEB, "SBC # (unoff)", 2, () => { this.sbc(this.mmu.read(this.addrIMM())); });
        def(0xE5, "SBC ZP", 3, () => { this.sbc(this.mmu.read(this.addrZP())); });
        def(0xF5, "SBC ZPX", 4, () => { this.sbc(this.mmu.read(this.addrZPX())); });
        def(0xED, "SBC ABS", 4, () => { this.sbc(this.mmu.read(this.addrABS())); });
        def(0xFD, "SBC ABSX", 4, () => { this.sbc(this.mmu.read(this.addrABSX())); });
        def(0xF9, "SBC ABSY", 4, () => { this.sbc(this.mmu.read(this.addrABSY())); });
        def(0xE1, "SBC INDX", 6, () => { this.sbc(this.mmu.read(this.addrINDX())); });
        def(0xF1, "SBC INDY", 5, () => { this.sbc(this.mmu.read(this.addrINDY())); });

        // CMP
        def(0xC9, "CMP #", 2, () => { this.cmp(this.a, this.mmu.read(this.addrIMM())); });
        def(0xC5, "CMP ZP", 3, () => { this.cmp(this.a, this.mmu.read(this.addrZP())); });
        def(0xD5, "CMP ZPX", 4, () => { this.cmp(this.a, this.mmu.read(this.addrZPX())); });
        def(0xCD, "CMP ABS", 4, () => { this.cmp(this.a, this.mmu.read(this.addrABS())); });
        def(0xDD, "CMP ABSX", 4, () => { this.cmp(this.a, this.mmu.read(this.addrABSX())); });
        def(0xD9, "CMP ABSY", 4, () => { this.cmp(this.a, this.mmu.read(this.addrABSY())); });
        def(0xC1, "CMP INDX", 6, () => { this.cmp(this.a, this.mmu.read(this.addrINDX())); });
        def(0xD1, "CMP INDY", 5, () => { this.cmp(this.a, this.mmu.read(this.addrINDY())); });

        // CPX
        def(0xE0, "CPX #", 2, () => { this.cmp(this.x, this.mmu.read(this.addrIMM())); });
        def(0xE4, "CPX ZP", 3, () => { this.cmp(this.x, this.mmu.read(this.addrZP())); });
        def(0xEC, "CPX ABS", 4, () => { this.cmp(this.x, this.mmu.read(this.addrABS())); });

        // CPY
        def(0xC0, "CPY #", 2, () => { this.cmp(this.y, this.mmu.read(this.addrIMM())); });
        def(0xC4, "CPY ZP", 3, () => { this.cmp(this.y, this.mmu.read(this.addrZP())); });
        def(0xCC, "CPY ABS", 4, () => { this.cmp(this.y, this.mmu.read(this.addrABS())); });

        // Inc/Dec
        def(0xE6, "INC ZP", 5, () => { const a = this.addrZP(); const v = (this.mmu.read(a) + 1) & 0xFF; this.mmu.write(a, v); this.setZN(v); });
        def(0xF6, "INC ZPX", 6, () => { const a = this.addrZPX(); const v = (this.mmu.read(a) + 1) & 0xFF; this.mmu.write(a, v); this.setZN(v); });
        def(0xEE, "INC ABS", 6, () => { const a = this.addrABS(); const v = (this.mmu.read(a) + 1) & 0xFF; this.mmu.write(a, v); this.setZN(v); });
        def(0xFE, "INC ABSX", 7, () => { const a = this.addrABSX(false); const v = (this.mmu.read(a) + 1) & 0xFF; this.mmu.write(a, v); this.setZN(v); });

        def(0xC6, "DEC ZP", 5, () => { const a = this.addrZP(); const v = (this.mmu.read(a) - 1) & 0xFF; this.mmu.write(a, v); this.setZN(v); });
        def(0xD6, "DEC ZPX", 6, () => { const a = this.addrZPX(); const v = (this.mmu.read(a) - 1) & 0xFF; this.mmu.write(a, v); this.setZN(v); });
        def(0xCE, "DEC ABS", 6, () => { const a = this.addrABS(); const v = (this.mmu.read(a) - 1) & 0xFF; this.mmu.write(a, v); this.setZN(v); });
        def(0xDE, "DEC ABSX", 7, () => { const a = this.addrABSX(false); const v = (this.mmu.read(a) - 1) & 0xFF; this.mmu.write(a, v); this.setZN(v); });

        def(0xE8, "INX", 2, () => { this.x = (this.x + 1) & 0xFF; this.setZN(this.x); });
        def(0xC8, "INY", 2, () => { this.y = (this.y + 1) & 0xFF; this.setZN(this.y); });
        def(0xCA, "DEX", 2, () => { this.x = (this.x - 1) & 0xFF; this.setZN(this.x); });
        def(0x88, "DEY", 2, () => { this.y = (this.y - 1) & 0xFF; this.setZN(this.y); });

        // Shifts & Rotates
        def(0x0A, "ASL A", 2, () => { this.a = this.asl(this.a); });
        def(0x06, "ASL ZP", 5, () => { const a = this.addrZP(); this.mmu.write(a, this.asl(this.mmu.read(a))); });
        def(0x16, "ASL ZPX", 6, () => { const a = this.addrZPX(); this.mmu.write(a, this.asl(this.mmu.read(a))); });
        def(0x0E, "ASL ABS", 6, () => { const a = this.addrABS(); this.mmu.write(a, this.asl(this.mmu.read(a))); });
        def(0x1E, "ASL ABSX", 7, () => { const a = this.addrABSX(false); this.mmu.write(a, this.asl(this.mmu.read(a))); });

        def(0x4A, "LSR A", 2, () => { this.a = this.lsr(this.a); });
        def(0x46, "LSR ZP", 5, () => { const a = this.addrZP(); this.mmu.write(a, this.lsr(this.mmu.read(a))); });
        def(0x56, "LSR ZPX", 6, () => { const a = this.addrZPX(); this.mmu.write(a, this.lsr(this.mmu.read(a))); });
        def(0x4E, "LSR ABS", 6, () => { const a = this.addrABS(); this.mmu.write(a, this.lsr(this.mmu.read(a))); });
        def(0x5E, "LSR ABSX", 7, () => { const a = this.addrABSX(false); this.mmu.write(a, this.lsr(this.mmu.read(a))); });

        def(0x2A, "ROL A", 2, () => { this.a = this.rol(this.a); });
        def(0x26, "ROL ZP", 5, () => { const a = this.addrZP(); this.mmu.write(a, this.rol(this.mmu.read(a))); });
        def(0x36, "ROL ZPX", 6, () => { const a = this.addrZPX(); this.mmu.write(a, this.rol(this.mmu.read(a))); });
        def(0x2E, "ROL ABS", 6, () => { const a = this.addrABS(); this.mmu.write(a, this.rol(this.mmu.read(a))); });
        def(0x3E, "ROL ABSX", 7, () => { const a = this.addrABSX(false); this.mmu.write(a, this.rol(this.mmu.read(a))); });

        def(0x6A, "ROR A", 2, () => { this.a = this.ror(this.a); });
        def(0x66, "ROR ZP", 5, () => { const a = this.addrZP(); this.mmu.write(a, this.ror(this.mmu.read(a))); });
        def(0x76, "ROR ZPX", 6, () => { const a = this.addrZPX(); this.mmu.write(a, this.ror(this.mmu.read(a))); });
        def(0x6E, "ROR ABS", 6, () => { const a = this.addrABS(); this.mmu.write(a, this.ror(this.mmu.read(a))); });
        def(0x7E, "ROR ABSX", 7, () => { const a = this.addrABSX(false); this.mmu.write(a, this.ror(this.mmu.read(a))); });

        // Jumps & Subroutines
        def(0x4C, "JMP ABS", 3, () => { this.pc = this.addrABS(); });
        def(0x6C, "JMP IND", 5, () => { this.pc = this.addrIND(); });
        def(0x20, "JSR ABS", 6, () => {
            const dest = this.addrABS();
            this.push16((this.pc - 1) & 0xFFFF);
            this.pc = dest;
        });
        def(0x60, "RTS", 6, () => {
            this.pc = (this.pull16() + 1) & 0xFFFF;
        });
        def(0x40, "RTI", 6, () => {
            this.p = (this.pull() & ~this.FLAG_B) | this.FLAG_U;
            this.pc = this.pull16();
        });

        // Branches
        def(0x90, "BCC", 2, () => { this.branch(!(this.p & this.FLAG_C)); });
        def(0xB0, "BCS", 2, () => { this.branch(!!(this.p & this.FLAG_C)); });
        def(0xF0, "BEQ", 2, () => { this.branch(!!(this.p & this.FLAG_Z)); });
        def(0xD0, "BNE", 2, () => { this.branch(!(this.p & this.FLAG_Z)); });
        def(0x10, "BPL", 2, () => { this.branch(!(this.p & this.FLAG_N)); });
        def(0x30, "BMI", 2, () => { this.branch(!!(this.p & this.FLAG_N)); });
        def(0x50, "BVC", 2, () => { this.branch(!(this.p & this.FLAG_V)); });
        def(0x70, "BVS", 2, () => { this.branch(!!(this.p & this.FLAG_V)); });

        // Status Flag Changes
        def(0x18, "CLC", 2, () => { this.p &= ~this.FLAG_C; });
        def(0x38, "SEC", 2, () => { this.p |= this.FLAG_C; });
        def(0x58, "CLI", 2, () => { this.p &= ~this.FLAG_I; });
        def(0x78, "SEI", 2, () => { this.p |= this.FLAG_I; });
        def(0xD8, "CLD", 2, () => { this.p &= ~this.FLAG_D; });
        def(0xF8, "SED", 2, () => { this.p |= this.FLAG_D; });
        def(0xB8, "CLV", 2, () => { this.p &= ~this.FLAG_V; });

        // System
        def(0xEA, "NOP", 2, () => {});
        def(0x00, "BRK", 7, () => {
            this.push16((this.pc + 1) & 0xFFFF);
            this.push(this.p | this.FLAG_B | this.FLAG_U);
            this.p |= this.FLAG_I;
            const lo = this.mmu.read(0xFFFE);
            const hi = this.mmu.read(0xFFFF);
            this.pc = (hi << 8) | lo;
        });

        // Common unofficial NOPs
        [0x1A, 0x3A, 0x5A, 0x7A, 0xDA, 0xFA].forEach(op => {
            def(op, "NOP (unoff)", 2, () => {});
        });
        [0x04, 0x44, 0x64].forEach(op => {
            def(op, "DOP (unoff)", 3, () => { this.addrZP(); });
        });
        [0x0C, 0x1C, 0x3C, 0x5C, 0x7C, 0xDC, 0xFC].forEach(op => {
            def(op, "TOP (unoff)", 4, () => { this.addrABS(); });
        });
    }

    getState() {
        return {
            pc: this.pc,
            a: this.a,
            x: this.x,
            y: this.y,
            sp: this.sp,
            p: this.p,
            cycles: this.cycles,
            flags: {
                N: !!(this.p & this.FLAG_N),
                V: !!(this.p & this.FLAG_V),
                D: !!(this.p & this.FLAG_D),
                I: !!(this.p & this.FLAG_I),
                Z: !!(this.p & this.FLAG_Z),
                C: !!(this.p & this.FLAG_C)
            }
        };
    }
}
