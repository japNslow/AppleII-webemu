// Apple II Video Graphics Generator
// Supports Text (40x24), Lo-Res (40x48), Hi-Res (280x192), Mixed Mode,
// Authentic NTSC artifact coloring, Green/Amber phosphor CRT shaders, and scanlines.

import { APPLE2_CHAR_ROM } from './roms.js';

export class VideoRenderer {
    constructor(canvas, mmu) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.mmu = mmu;

        // Native Apple II internal resolution: 280 x 192
        // We render to an ImageData buffer of 560 x 384 (2x horizontal & vertical)
        // for crisp color artifacting and scanline rendering.
        this.width = 560;
        this.height = 384;
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.imgData = this.ctx.createImageData(this.width, this.height);
        this.pixels = new Uint32Array(this.imgData.data.buffer);

        // Display configuration
        this.colorMode = 'color'; // 'color', 'green', 'amber', 'bw'
        this.scanlines = true;
        this.flashState = false;  // 2Hz flash toggle for flashing text
        this.flashCounter = 0;

        // 16 Standard Apple II Colors (RGBA 32-bit little endian: 0xAABBGGRR)
        this.paletteLoRes = [
            0xFF000000, // 0 Black
            0xFF401790, // 1 Deep Red / Magenta
            0xFFA52C40, // 2 Dark Blue
            0xFFE543D0, // 3 Purple
            0xFF406900, // 4 Dark Green
            0xFF808080, // 5 Grey 1
            0xFFE5952F, // 6 Medium Blue
            0xFFF5C6B7, // 7 Light Blue
            0xFF004B40, // 8 Brown
            0xFF0068E6, // 9 Orange
            0xFFA0A0A0, // 10 Grey 2
            0xFFC69EF5, // 11 Pink
            0xFF40B82F, // 12 Light Green
            0xFF1AD5D5, // 13 Yellow
            0xFFB8E27B, // 14 Aqua
            0xFFFFFFFF  // 15 White
        ];

        // Hi-Res Colors
        // 0: Black, 1: Green, 2: Violet, 3: White, 4: Black, 5: Orange, 6: Blue, 7: White
        this.paletteHiRes = [
            0xFF000000, // Black
            0xFF2FB840, // Green
            0xFFD043E5, // Violet
            0xFFFFFFFF, // White
            0xFF000000, // Black
            0xFF0068E6, // Orange
            0xFFE5952F, // Blue
            0xFFFFFFFF  // White
        ];

        // Monochrome Phosphor Tints
        this.tintGreen = { r: 0x33, g: 0xFF, b: 0x33 };
        this.tintAmber = { r: 0xFF, g: 0xB0, b: 0x00 };
        this.tintWhite = { r: 0xEE, g: 0xEE, b: 0xEE };
    }

    setColorMode(mode) {
        this.colorMode = mode;
    }

    setScanlines(enabled) {
        this.scanlines = enabled;
    }

    // Interleaved text row base address
    static getTextRowOffset(row, page2) {
        const base = page2 ? 0x0800 : 0x0400;
        return base + ((row & 7) * 0x80) + ((row >> 3) * 0x28);
    }

    // Interleaved Hi-Res scanline base address
    static getHgrScanlineOffset(y, page2) {
        const base = page2 ? 0x4000 : 0x2000;
        return base + ((y & 7) * 0x0400) + (((y >> 3) & 7) * 0x0080) + ((y >> 6) * 0x0028);
    }

    render() {
        this.flashCounter++;
        if (this.flashCounter >= 16) {
            this.flashState = !this.flashState;
            this.flashCounter = 0;
        }

        const switches = this.mmu.switches;

        if (switches.text) {
            this.renderText(switches.page2, 0, 24);
        } else if (switches.hires) {
            const hgrLines = switches.mixed ? 160 : 192;
            this.renderHiRes(switches.page2, hgrLines);
            if (switches.mixed) {
                this.renderText(switches.page2, 20, 24);
            }
        } else {
            const grLines = switches.mixed ? 40 : 48;
            this.renderLoRes(switches.page2, grLines);
            if (switches.mixed) {
                this.renderText(switches.page2, 20, 24);
            }
        }

        // Apply phosphor tint and scanlines if requested
        this.applyPostProcessing();

        this.ctx.putImageData(this.imgData, 0, 0);
    }

    renderText(page2, startRow, endRow) {
        const ram = this.mmu.ram;

        for (let row = startRow; row < endRow; row++) {
            const rowBase = VideoRenderer.getTextRowOffset(row, page2);

            for (let col = 0; col < 40; col++) {
                const charCode = ram[rowBase + col];
                this.renderChar(col, row, charCode);
            }
        }
    }

    renderChar(col, row, byteVal) {
        // Character attributes
        let inverse = false;
        let ascii = 0;

        if (byteVal < 0x40) {
            // Inverse Uppercase / Numbers / Symbols
            inverse = true;
            ascii = byteVal + 0x40; // Convert to ASCII
        } else if (byteVal < 0x80) {
            // Flashing
            inverse = this.flashState;
            ascii = (byteVal & 0x3F) + 0x40;
        } else {
            // Normal
            inverse = false;
            ascii = byteVal & 0x7F;
        }

        // Map ASCII char to 8-byte font bitmap in APPLE2_CHAR_ROM
        // Font ROM starts at ASCII 0x20 (space) up to 0x7F
        let charIndex = ascii - 0x20;
        if (charIndex < 0 || charIndex >= 96) {
            charIndex = 0; // Space
        }
        const fontOffset = charIndex * 8;

        const fgColor = inverse ? 0xFF000000 : 0xFFFFFFFF;
        const bgColor = inverse ? 0xFFFFFFFF : 0xFF000000;

        const startX = col * 14;   // 40 * 14 = 560
        const startY = row * 16;   // 24 * 16 = 384

        for (let line = 0; line < 8; line++) {
            const fontRow = APPLE2_CHAR_ROM[fontOffset + line];
            const y1 = startY + line * 2;
            const y2 = y1 + 1;

            for (let dot = 0; dot < 7; dot++) {
                // Bit 0 is leftmost pixel in Apple II character ROM
                const pixelOn = (fontRow & (1 << dot)) !== 0;
                const color = pixelOn ? fgColor : bgColor;

                const x1 = startX + dot * 2;
                const x2 = x1 + 1;

                this.pixels[y1 * this.width + x1] = color;
                this.pixels[y1 * this.width + x2] = color;
                this.pixels[y2 * this.width + x1] = color;
                this.pixels[y2 * this.width + x2] = color;
            }
        }
    }

    renderLoRes(page2, totalBlocksY) {
        const ram = this.mmu.ram;

        for (let blockY = 0; blockY < totalBlocksY; blockY++) {
            const textRow = blockY >> 1;
            const isBottomNibble = (blockY & 1) === 1;
            const rowBase = VideoRenderer.getTextRowOffset(textRow, page2);
            const startY = blockY * 8; // Each block is 8 screen scanlines (4 native * 2)

            for (let col = 0; col < 40; col++) {
                const byteVal = ram[rowBase + col];
                const colorIndex = isBottomNibble ? (byteVal >> 4) & 0x0F : byteVal & 0x0F;
                const color = this.paletteLoRes[colorIndex];

                const startX = col * 14;

                for (let dy = 0; dy < 8; dy++) {
                    const rowOffset = (startY + dy) * this.width;
                    for (let dx = 0; dx < 14; dx++) {
                        this.pixels[rowOffset + startX + dx] = color;
                    }
                }
            }
        }
    }

    renderHiRes(page2, totalScanlines) {
        const ram = this.mmu.ram;

        // Decode scanlines with authentic Apple II NTSC composite artifacting
        for (let y = 0; y < totalScanlines; y++) {
            const offset = VideoRenderer.getHgrScanlineOffset(y, page2);

            // Decode 280 dots + palette delay bit for each byte
            // Pre-decode dots into a 280-length array with color palette bit
            const dots = new Uint8Array(280);
            const palettes = new Uint8Array(280);

            let dotIdx = 0;
            for (let b = 0; b < 40; b++) {
                const byteVal = ram[offset + b];
                const pal = (byteVal & 0x80) ? 4 : 0; // Palette 1 if bit 7 = 1

                for (let bit = 0; bit < 7; bit++) {
                    dots[dotIdx] = (byteVal >> bit) & 1;
                    palettes[dotIdx] = pal;
                    dotIdx++;
                }
            }

            const y1 = y * 2;
            const y2 = y1 + 1;
            const row1 = y1 * this.width;
            const row2 = y2 * this.width;

            for (let x = 0; x < 280; x++) {
                let color;

                if (this.colorMode !== 'color') {
                    // Monochrome: straightforward dot illumination
                    color = dots[x] ? 0xFFFFFFFF : 0xFF000000;
                } else {
                    // Composite color artifacting:
                    // If adjacent dots are 1, it renders white.
                    // If current dot is 1, color is decided by (x % 2) and palette bit.
                    const curr = dots[x];
                    const prev = x > 0 ? dots[x - 1] : 0;
                    const next = x < 279 ? dots[x + 1] : 0;

                    if (curr === 1) {
                        if (prev === 1 || next === 1) {
                            color = 0xFFFFFFFF; // White
                        } else {
                            const pal = palettes[x];
                            // Even col: Violet (pal 0) or Blue (pal 1)
                            // Odd col: Green (pal 0) or Orange (pal 1)
                            const isOdd = (x & 1);
                            if (isOdd) {
                                color = pal === 0 ? this.paletteHiRes[1] : this.paletteHiRes[5]; // Green or Orange
                            } else {
                                color = pal === 0 ? this.paletteHiRes[2] : this.paletteHiRes[6]; // Violet or Blue
                            }
                        }
                    } else {
                        // Current is 0. If surrounded by 1s, black
                        color = 0xFF000000;
                    }
                }

                const px = x * 2;
                this.pixels[row1 + px] = color;
                this.pixels[row1 + px + 1] = color;
                this.pixels[row2 + px] = color;
                this.pixels[row2 + px + 1] = color;
            }
        }
    }

    applyPostProcessing() {
        const isScanlines = this.scanlines;
        const mode = this.colorMode;

        if (mode === 'color' && !isScanlines) {
            return;
        }

        let tint = null;
        if (mode === 'green') tint = this.tintGreen;
        else if (mode === 'amber') tint = this.tintAmber;
        else if (mode === 'bw') tint = this.tintWhite;

        const len = this.pixels.length;

        for (let i = 0; i < len; i++) {
            const pixel = this.pixels[i];
            const r = pixel & 0xFF;
            const g = (pixel >> 8) & 0xFF;
            const b = (pixel >> 16) & 0xFF;

            const y = Math.floor(i / this.width);
            const isScanlineRow = (y & 1) === 1;

            if (tint) {
                // Luminance calculation
                const lum = (r * 77 + g * 150 + b * 29) >> 8;
                let tr = Math.min(255, Math.floor((lum * tint.r) / 255));
                let tg = Math.min(255, Math.floor((lum * tint.g) / 255));
                let tb = Math.min(255, Math.floor((lum * tint.b) / 255));

                if (isScanlines && isScanlineRow) {
                    tr = Math.floor(tr * 0.7);
                    tg = Math.floor(tg * 0.7);
                    tb = Math.floor(tb * 0.7);
                }

                this.pixels[i] = 0xFF000000 | (tb << 16) | (tg << 8) | tr;
            } else if (isScanlines && isScanlineRow) {
                // Color mode scanlines: darken alternating rows
                const dr = Math.floor(r * 0.75);
                const dg = Math.floor(g * 0.75);
                const db = Math.floor(b * 0.75);
                this.pixels[i] = 0xFF000000 | (db << 16) | (dg << 8) | dr;
            }
        }
    }
}
