// Apple II Interactive 6502 Disassembler & Memory Inspector
// Provides real-time CPU register inspection, live disassembly, and memory hex viewing.

export class Apple2Debugger {
    constructor(cpu, mmu) {
        this.cpu = cpu;
        this.mmu = mmu;
        this.breakpoints = new Set();
        this.stepMode = false;

        this.initDisasmLookup();
    }

    initDisasmLookup() {
        // Table mapping opcodes to mnemonic, size, and addressing format
        this.disasmTable = new Array(256);

        const d = (code, mnemonic, mode, size) => {
            this.disasmTable[code] = { mnemonic, mode, size };
        };

        // All 6502 instructions
        d(0x69, "ADC", "IMM", 2); d(0x65, "ADC", "ZP", 2);  d(0x75, "ADC", "ZPX", 2);
        d(0x6D, "ADC", "ABS", 3); d(0x7D, "ADC", "ABSX", 3); d(0x79, "ADC", "ABSY", 3);
        d(0x61, "ADC", "INDX", 2); d(0x71, "ADC", "INDY", 2);

        d(0x29, "AND", "IMM", 2); d(0x25, "AND", "ZP", 2);  d(0x35, "AND", "ZPX", 2);
        d(0x2D, "AND", "ABS", 3); d(0x3D, "AND", "ABSX", 3); d(0x39, "AND", "ABSY", 3);
        d(0x21, "AND", "INDX", 2); d(0x31, "AND", "INDY", 2);

        d(0x0A, "ASL", "ACC", 1); d(0x06, "ASL", "ZP", 2);  d(0x16, "ASL", "ZPX", 2);
        d(0x0E, "ASL", "ABS", 3); d(0x1E, "ASL", "ABSX", 3);

        d(0x90, "BCC", "REL", 2); d(0xB0, "BCS", "REL", 2); d(0xF0, "BEQ", "REL", 2);
        d(0x30, "BMI", "REL", 2); d(0xD0, "BNE", "REL", 2); d(0x10, "BPL", "REL", 2);
        d(0x50, "BVC", "REL", 2); d(0x70, "BVS", "REL", 2);

        d(0x24, "BIT", "ZP", 2);  d(0x2C, "BIT", "ABS", 3);
        d(0x00, "BRK", "IMP", 1);

        d(0x18, "CLC", "IMP", 1); d(0x38, "SEC", "IMP", 1);
        d(0x58, "CLI", "IMP", 1); d(0x78, "SEI", "IMP", 1);
        d(0xD8, "CLD", "IMP", 1); d(0xF8, "SED", "IMP", 1);
        d(0xB8, "CLV", "IMP", 1);

        d(0xC9, "CMP", "IMM", 2); d(0xC5, "CMP", "ZP", 2);  d(0xD5, "CMP", "ZPX", 2);
        d(0xCD, "CMP", "ABS", 3); d(0xDD, "CMP", "ABSX", 3); d(0xD9, "CMP", "ABSY", 3);
        d(0xC1, "CMP", "INDX", 2); d(0xD1, "CMP", "INDY", 2);

        d(0xE0, "CPX", "IMM", 2); d(0xE4, "CPX", "ZP", 2);  d(0xEC, "CPX", "ABS", 3);
        d(0xC0, "CPY", "IMM", 2); d(0xC4, "CPY", "ZP", 2);  d(0xCC, "CPY", "ABS", 3);

        d(0xC6, "DEC", "ZP", 2);  d(0xD6, "DEC", "ZPX", 2);
        d(0xCE, "DEC", "ABS", 3); d(0xDE, "DEC", "ABSX", 3);
        d(0xCA, "DEX", "IMP", 1); d(0x88, "DEY", "IMP", 1);

        d(0x49, "EOR", "IMM", 2); d(0x45, "EOR", "ZP", 2);  d(0x55, "EOR", "ZPX", 2);
        d(0x4D, "EOR", "ABS", 3); d(0x5D, "EOR", "ABSX", 3); d(0x59, "EOR", "ABSY", 3);
        d(0x41, "EOR", "INDX", 2); d(0x51, "EOR", "INDY", 2);

        d(0xE6, "INC", "ZP", 2);  d(0xF6, "INC", "ZPX", 2);
        d(0xEE, "INC", "ABS", 3); d(0xFE, "INC", "ABSX", 3);
        d(0xE8, "INX", "IMP", 1); d(0xC8, "INY", "IMP", 1);

        d(0x4C, "JMP", "ABS", 3); d(0x6C, "JMP", "IND", 3);
        d(0x20, "JSR", "ABS", 3);

        d(0xA9, "LDA", "IMM", 2); d(0xA5, "LDA", "ZP", 2);  d(0xB5, "LDA", "ZPX", 2);
        d(0xAD, "LDA", "ABS", 3); d(0xBD, "LDA", "ABSX", 3); d(0xB9, "LDA", "ABSY", 3);
        d(0xA1, "LDA", "INDX", 2); d(0xB1, "LDA", "INDY", 2);

        d(0xA2, "LDX", "IMM", 2); d(0xA6, "LDX", "ZP", 2);  d(0xB6, "LDX", "ZPY", 2);
        d(0xAE, "LDX", "ABS", 3); d(0xBE, "LDX", "ABSY", 3);

        d(0xA0, "LDY", "IMM", 2); d(0xA4, "LDY", "ZP", 2);  d(0xB4, "LDY", "ZPX", 2);
        d(0xAC, "LDY", "ABS", 3); d(0xBC, "LDY", "ABSX", 3);

        d(0x4A, "LSR", "ACC", 1); d(0x46, "LSR", "ZP", 2);  d(0x56, "LSR", "ZPX", 2);
        d(0x4E, "LSR", "ABS", 3); d(0x5E, "LSR", "ABSX", 3);

        d(0xEA, "NOP", "IMP", 1);

        d(0x09, "ORA", "IMM", 2); d(0x05, "ORA", "ZP", 2);  d(0x15, "ORA", "ZPX", 2);
        d(0x0D, "ORA", "ABS", 3); d(0x1D, "ORA", "ABSX", 3); d(0x19, "ORA", "ABSY", 3);
        d(0x01, "ORA", "INDX", 2); d(0x11, "ORA", "INDY", 2);

        d(0x48, "PHA", "IMP", 1); d(0x08, "PHP", "IMP", 1);
        d(0x68, "PLA", "IMP", 1); d(0x28, "PLP", "IMP", 1);

        d(0x2A, "ROL", "ACC", 1); d(0x26, "ROL", "ZP", 2);  d(0x36, "ROL", "ZPX", 2);
        d(0x2E, "ROL", "ABS", 3); d(0x3E, "ROL", "ABSX", 3);

        d(0x6A, "ROR", "ACC", 1); d(0x66, "ROR", "ZP", 2);  d(0x76, "ROR", "ZPX", 2);
        d(0x6E, "ROR", "ABS", 3); d(0x7E, "ROR", "ABSX", 3);

        d(0x40, "RTI", "IMP", 1); d(0x60, "RTS", "IMP", 1);

        d(0xE9, "SBC", "IMM", 2); d(0xEB, "SBC", "IMM", 2);
        d(0xE5, "SBC", "ZP", 2);  d(0xF5, "SBC", "ZPX", 2);
        d(0xED, "SBC", "ABS", 3); d(0xFD, "SBC", "ABSX", 3); d(0xF9, "SBC", "ABSY", 3);
        d(0xE1, "SBC", "INDX", 2); d(0xF1, "SBC", "INDY", 2);

        d(0x85, "STA", "ZP", 2);  d(0x95, "STA", "ZPX", 2);
        d(0x8D, "STA", "ABS", 3); d(0x9D, "STA", "ABSX", 3); d(0x99, "STA", "ABSY", 3);
        d(0x81, "STA", "INDX", 2); d(0x91, "STA", "INDY", 2);

        d(0x86, "STX", "ZP", 2);  d(0x96, "STX", "ZPY", 2);  d(0x8E, "STX", "ABS", 3);
        d(0x84, "STY", "ZP", 2);  d(0x94, "STY", "ZPX", 2);  d(0x8C, "STY", "ABS", 3);

        d(0xAA, "TAX", "IMP", 1); d(0x8A, "TXA", "IMP", 1);
        d(0xA8, "TAY", "IMP", 1); d(0x98, "TYA", "IMP", 1);
        d(0xBA, "TSX", "IMP", 1); d(0x9A, "TXS", "IMP", 1);
    }

    hex2(v) {
        return (v & 0xFF).toString(16).padStart(2, '0').toUpperCase();
    }

    hex4(v) {
        return (v & 0xFFFF).toString(16).padStart(4, '0').toUpperCase();
    }

    disassemble(addr) {
        const opcode = this.mmu.read(addr);
        const info = this.disasmTable[opcode];

        if (!info) {
            return {
                addr,
                bytes: [opcode],
                text: `.BYTE $${this.hex2(opcode)}`,
                size: 1
            };
        }

        const b1 = this.mmu.read((addr + 1) & 0xFFFF);
        const b2 = this.mmu.read((addr + 2) & 0xFFFF);
        let operandStr = "";

        switch (info.mode) {
            case "IMP":
                operandStr = "";
                break;
            case "ACC":
                operandStr = "A";
                break;
            case "IMM":
                operandStr = `#$${this.hex2(b1)}`;
                break;
            case "ZP":
                operandStr = `$${this.hex2(b1)}`;
                break;
            case "ZPX":
                operandStr = `$${this.hex2(b1)},X`;
                break;
            case "ZPY":
                operandStr = `$${this.hex2(b1)},Y`;
                break;
            case "ABS":
                operandStr = `$${this.hex4((b2 << 8) | b1)}`;
                break;
            case "ABSX":
                operandStr = `$${this.hex4((b2 << 8) | b1)},X`;
                break;
            case "ABSY":
                operandStr = `$${this.hex4((b2 << 8) | b1)},Y`;
                break;
            case "IND":
                operandStr = `($${this.hex4((b2 << 8) | b1)})`;
                break;
            case "INDX":
                operandStr = `($${this.hex2(b1)},X)`;
                break;
            case "INDY":
                operandStr = `($${this.hex2(b1)}),Y`;
                break;
            case "REL":
                const signedOffset = b1 > 127 ? b1 - 256 : b1;
                const dest = (addr + 2 + signedOffset) & 0xFFFF;
                operandStr = `$${this.hex4(dest)}`;
                break;
        }

        const bytes = [opcode];
        if (info.size > 1) bytes.push(b1);
        if (info.size > 2) bytes.push(b2);

        return {
            addr,
            bytes,
            text: `${info.mnemonic} ${operandStr}`.trim(),
            size: info.size
        };
    }

    disassembleRange(startAddr, instructionCount = 15) {
        const lines = [];
        let cur = startAddr & 0xFFFF;

        for (let i = 0; i < instructionCount; i++) {
            const instr = this.disassemble(cur);
            const hexBytes = instr.bytes.map(b => this.hex2(b)).join(' ').padEnd(9, ' ');
            lines.push({
                addr: instr.addr,
                isPC: instr.addr === this.cpu.pc,
                hasBreakpoint: this.breakpoints.has(instr.addr),
                text: `${this.hex4(instr.addr)}:  ${hexBytes}  ${instr.text}`
            });
            cur = (cur + instr.size) & 0xFFFF;
        }

        return lines;
    }

    getMemoryDump(startAddr, rows = 8) {
        const dump = [];
        let base = startAddr & 0xFFF0; // Align to 16 bytes

        for (let r = 0; r < rows; r++) {
            const rowAddr = (base + r * 16) & 0xFFFF;
            const bytes = [];
            let ascii = "";

            for (let c = 0; c < 16; c++) {
                const b = this.mmu.read((rowAddr + c) & 0xFFFF);
                bytes.push(this.hex2(b));
                const ch = (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
                ascii += ch;
            }

            dump.push({
                addr: this.hex4(rowAddr),
                hex: bytes.join(' '),
                ascii
            });
        }

        return dump;
    }
}
