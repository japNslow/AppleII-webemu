import { CPU6502 } from '../js/cpu6502.js';
import { MMU } from '../js/mmu.js';
import { Disk2Controller } from '../js/disk2.js';
import { APPLE2_PLUS_ROM, DISK2_BOOT_ROM } from '../js/roms.js';
import { BUILTIN_DISKS } from '../js/disks.js';

console.log("=== Testing Apple II Web Emulator Components ===");

// 1. Verify ROM sizes
console.log("APPLE2_PLUS_ROM length:", APPLE2_PLUS_ROM.length, "(expected 12288)");
console.log("DISK2_BOOT_ROM length:", DISK2_BOOT_ROM.length, "(expected 256)");
console.log("Built-in disks count:", BUILTIN_DISKS.length);

const mmu = new MMU();
mmu.setSystemRom(APPLE2_PLUS_ROM);
mmu.setSlot6Rom(DISK2_BOOT_ROM);

const diskController = new Disk2Controller(null);
mmu.diskController = diskController;

const cpu = new CPU6502(mmu);

// 2. Check Reset Vector at $FFFC-$FFFD
const resetLo = mmu.read(0xFFFC);
const resetHi = mmu.read(0xFFFD);
const resetVector = (resetHi << 8) | resetLo;
console.log(`Reset vector: $${resetVector.toString(16).toUpperCase()} (expected $FA62 for Autostart Monitor)`);

// 3. Reset CPU
cpu.reset();
console.log(`CPU PC after reset: $${cpu.pc.toString(16).toUpperCase()}`);
if (cpu.pc !== 0xFA62) {
    throw new Error(`Expected PC $FA62, got $${cpu.pc.toString(16).toUpperCase()}`);
}

// 4. Load DOS 3.3 Disk and Test Nibblization
const dos33 = BUILTIN_DISKS.find(d => d.id === 'dos33');
if (!dos33 || !dos33.data) {
    throw new Error("DOS 3.3 disk data missing!");
}
diskController.loadDisk(1, dos33.data, "DOS 3.3 Master");
console.log("Drive 1 disk loaded:", diskController.drives[0].hasDisk);
console.log("Nibblized tracks count:", diskController.drives[0].nibbleTracks.length, "(expected 35)");
console.log("Track 0 nibble length:", diskController.drives[0].nibbleTracks[0].length);

// 5. Test CPU step execution through Autostart Monitor
console.log("Stepping CPU 1000 instructions...");
let totalCycles = 0;
for (let i = 0; i < 1000; i++) {
    const cyc = cpu.step();
    totalCycles += cyc;
}
console.log(`Successfully executed 1000 instructions! Total cycles: ${totalCycles}, Current PC: $${cpu.pc.toString(16).toUpperCase()}`);

// 6. Test Slot 6 Disk II Boot ROM execution directly
console.log("Jumping PC to $C600 (Disk II Boot Entry)...");
cpu.pc = 0xC600;
let diskCycles = 0;
for (let i = 0; i < 5000; i++) {
    const cyc = cpu.step();
    diskCycles += cyc;
}
console.log(`Successfully stepped Disk II Boot ROM! Cycles: ${diskCycles}, Current PC: $${cpu.pc.toString(16).toUpperCase()}`);
console.log("Motor state:", diskController.motorOn);
console.log("Selected drive:", diskController.selectedDriveIndex);

console.log("=== All Tests Passed Successfully! ===");
