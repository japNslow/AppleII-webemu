// Disk II Floppy Controller Subsystem (Slot 6, $C0E0-$C0EF)
// Implements 16-sector 6-and-2 GCR encoding/decoding, stepper motor phase tracking,
// track nibblization, spindle motor control, and drive activity indicators.

export class Disk2Controller {
    constructor(audio) {
        this.audio = audio;

        // Two drives supported: Drive 1 and Drive 2
        this.drives = [
            new DiskDrive(1, audio),
            new DiskDrive(2, audio)
        ];
        this.selectedDriveIndex = 0; // 0 = Drive 1, 1 = Drive 2

        // Controller state
        this.motorOn = false;
        this.writeMode = false;
        this.phases = [false, false, false, false];

        // Callbacks for UI events
        this.onDriveStateChange = null;
    }

    get selectedDrive() {
        return this.drives[this.selectedDriveIndex];
    }

    reset() {
        this.motorOn = false;
        this.writeMode = false;
        this.phases = [false, false, false, false];
        this.drives[0].motorOn = false;
        this.drives[1].motorOn = false;
        if (this.audio) {
            this.audio.stopMotorSound();
        }
        this.notifyState();
    }

    notifyState() {
        if (this.onDriveStateChange) {
            this.onDriveStateChange({
                motorOn: this.motorOn,
                drive1: {
                    loaded: this.drives[0].hasDisk,
                    name: this.drives[0].name,
                    track: this.drives[0].track,
                    active: this.motorOn && this.selectedDriveIndex === 0
                },
                drive2: {
                    loaded: this.drives[1].hasDisk,
                    name: this.drives[1].name,
                    track: this.drives[1].track,
                    active: this.motorOn && this.selectedDriveIndex === 1
                }
            });
        }
    }

    // Access softswitch $C0E0 + switchNum (0x0..0xF)
    access(switchNum, isWrite, writeVal) {
        const drive = this.selectedDrive;

        switch (switchNum) {
            // Stepper motor phases 0..3 off/on
            case 0x00: this.setPhase(0, false); break;
            case 0x01: this.setPhase(0, true);  break;
            case 0x02: this.setPhase(1, false); break;
            case 0x03: this.setPhase(1, true);  break;
            case 0x04: this.setPhase(2, false); break;
            case 0x05: this.setPhase(2, true);  break;
            case 0x06: this.setPhase(3, false); break;
            case 0x07: this.setPhase(3, true);  break;

            // Spindle motor off / on
            case 0x08:
                this.motorOn = false;
                drive.motorOn = false;
                if (this.audio) this.audio.stopMotorSound();
                this.notifyState();
                break;
            case 0x09:
                this.motorOn = true;
                drive.motorOn = true;
                if (this.audio) this.audio.startMotorSound();
                this.notifyState();
                break;

            // Drive selection
            case 0x0A:
                this.selectedDriveIndex = 0;
                this.notifyState();
                break;
            case 0x0B:
                this.selectedDriveIndex = 1;
                this.notifyState();
                break;

            // Shift register read / shift
            case 0x0C:
                this.writeMode = false;
                if (this.motorOn && drive.hasDisk) {
                    return drive.readNextNibble();
                }
                return 0x00;

            // Shift register write / load
            case 0x0D:
                if (this.writeMode && this.motorOn && drive.hasDisk) {
                    drive.writeNextNibble(writeVal);
                }
                return 0x00;

            // Read mode
            case 0x0E:
                this.writeMode = false;
                if (drive.isWriteProtected()) {
                    return 0x80; // Write protected bit
                }
                return 0x00;

            // Write mode
            case 0x0F:
                this.writeMode = true;
                return 0x00;
        }

        return 0x00;
    }

    setPhase(phaseIndex, on) {
        this.phases[phaseIndex] = on;
        if (on) {
            this.selectedDrive.stepPhase(phaseIndex);
            this.notifyState();
        }
    }

    loadDisk(driveNumber, diskData, name = "Disk") {
        const drive = this.drives[driveNumber - 1];
        if (drive) {
            drive.insertDisk(diskData, name);
            this.notifyState();
        }
    }

    ejectDisk(driveNumber) {
        const drive = this.drives[driveNumber - 1];
        if (drive) {
            drive.eject();
            this.notifyState();
        }
    }
}

// GCR 6-and-2 Constants & Skew tables
const GCR_WRITE_TABLE = [
    0x96, 0x97, 0x9A, 0x9B, 0x9D, 0x9E, 0x9F, 0xA6,
    0xA7, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF, 0xB2, 0xB3,
    0xB4, 0xB5, 0xB6, 0xB7, 0xB9, 0xBA, 0xBC, 0xBD,
    0xBE, 0xBF, 0xCB, 0xCD, 0xCE, 0xCF, 0xD3, 0xD6,
    0xD7, 0xD9, 0xDA, 0xDB, 0xDC, 0xDD, 0xDE, 0xDF,
    0xE5, 0xE6, 0xE7, 0xE9, 0xEA, 0xEB, 0xEC, 0xED,
    0xEE, 0xEF, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7,
    0xF9, 0xFA, 0xFC, 0xFD, 0xFE, 0xFF
];

// DOS 3.3 16-sector interleave skew
const DOS33_SKEW = [
    0x0, 0x7, 0xE, 0x6, 0xD, 0x5, 0xC, 0x4,
    0xB, 0x3, 0xA, 0x2, 0x9, 0x1, 0x8, 0xF
];

// ProDOS 16-sector interleave skew
const PRODOS_SKEW = [
    0x0, 0x8, 0x1, 0x9, 0x2, 0xA, 0x3, 0xB,
    0x4, 0xC, 0x5, 0xD, 0x6, 0xE, 0x7, 0xF
];

export class DiskDrive {
    constructor(driveNumber, audio) {
        this.driveNumber = driveNumber;
        this.audio = audio;

        this.hasDisk = false;
        this.name = "";
        this.rawDiskData = null; // 143,360 bytes
        this.writeProtected = false;

        // Head position in half-tracks (0..69)
        this.halfTrack = 0;
        this.currentPhase = 0;

        // Nibblized track buffers: 35 tracks, ~6656 nibbles each
        this.nibbleTracks = [];
        this.trackByteIndices = new Uint32Array(35);

        this.motorOn = false;
    }

    get track() {
        return Math.floor(this.halfTrack / 2);
    }

    isWriteProtected() {
        return this.writeProtected;
    }

    stepPhase(phase) {
        const oldTrack = this.track;
        const diff = (phase - this.currentPhase) & 3;

        if (diff === 1) {
            // Step forward
            if (this.halfTrack < 69) this.halfTrack++;
        } else if (diff === 3) {
            // Step backward
            if (this.halfTrack > 0) this.halfTrack--;
        }

        this.currentPhase = phase;

        if (this.track !== oldTrack && this.audio) {
            this.audio.stepSound();
        }
    }

    insertDisk(data, name = "Disk") {
        if (!data || data.length < 143360) {
            console.error('Invalid disk image size. Standard 16-sector DSK is 143,360 bytes');
            return false;
        }

        this.rawDiskData = new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + 143360) : data);
        this.name = name;
        this.hasDisk = true;
        this.nibblizeDisk();
        return true;
    }

    eject() {
        this.hasDisk = false;
        this.name = "";
        this.rawDiskData = null;
        this.nibbleTracks = [];
    }

    readNextNibble() {
        const trk = this.track;
        if (trk >= 35 || !this.nibbleTracks[trk]) {
            return 0x00;
        }

        const trackBuf = this.nibbleTracks[trk];
        const idx = this.trackByteIndices[trk];
        const byte = trackBuf[idx];

        this.trackByteIndices[trk] = (idx + 1) % trackBuf.length;
        return byte;
    }

    writeNextNibble(val) {
        const trk = this.track;
        if (trk >= 35 || !this.nibbleTracks[trk] || this.writeProtected) {
            return;
        }
        const trackBuf = this.nibbleTracks[trk];
        const idx = this.trackByteIndices[trk];
        trackBuf[idx] = val;
        this.trackByteIndices[trk] = (idx + 1) % trackBuf.length;
    }

    // Convert standard 140KB raw sectors into GCR 6-and-2 nibble streams
    nibblizeDisk() {
        this.nibbleTracks = [];

        // Check if disk appears to be ProDOS or DOS 3.3
        // Sector skew defaults to DOS 3.3 for standard .dsk
        const skew = DOS33_SKEW;

        for (let trk = 0; trk < 35; trk++) {
            const trackNibbles = [];

            // Add initial track lead-in sync gap
            for (let i = 0; i < 48; i++) trackNibbles.push(0xFF);

            // 16 sectors per track
            for (let s = 0; s < 16; s++) {
                const sectorNum = s;
                const physicalSector = skew[sectorNum];
                const sectorOffset = (trk * 16 + physicalSector) * 256;
                const sectorBytes = this.rawDiskData.subarray(sectorOffset, sectorOffset + 256);

                // --- 1. Address Field ---
                // Sync gap 1
                for (let i = 0; i < 6; i++) trackNibbles.push(0xFF);

                // Address prologue: D5 AA 96
                trackNibbles.push(0xD5, 0xAA, 0x96);

                // 4-and-4 encoded Volume (254), Track, Sector, Checksum
                const volume = 254;
                const chk = volume ^ trk ^ sectorNum;

                this.push4and4(trackNibbles, volume);
                this.push4and4(trackNibbles, trk);
                this.push4and4(trackNibbles, sectorNum);
                this.push4and4(trackNibbles, chk);

                // Address epilogue: DE AA EB
                trackNibbles.push(0xDE, 0xAA, 0xEB);

                // --- 2. Data Field ---
                // Sync gap 2
                for (let i = 0; i < 6; i++) trackNibbles.push(0xFF);

                // Data prologue: D5 AA AD
                trackNibbles.push(0xD5, 0xAA, 0xAD);

                // 6-and-2 GCR Encode 256 bytes into 342 nibbles
                this.encode6and2(trackNibbles, sectorBytes);

                // Data epilogue: DE AA EB
                trackNibbles.push(0xDE, 0xAA, 0xEB);

                // Sync gap 3
                for (let i = 0; i < 18; i++) trackNibbles.push(0xFF);
            }

            this.nibbleTracks.push(new Uint8Array(trackNibbles));
            this.trackByteIndices[trk] = 0;
        }
    }

    push4and4(arr, val) {
        // Even bits OR 0xAA, Odd bits shifted right OR 0xAA
        arr.push(((val >> 1) & 0x55) | 0xAA);
        arr.push((val & 0x55) | 0xAA);
    }

    encode6and2(outNibbles, sectorData) {
        // Secondary buffer of 86 bytes for the 2 low bits
        const bit2Buf = new Uint8Array(86);
        let bit2Idx = 0;
        let shift = 0;

        for (let i = 0; i < 256; i++) {
            const b = sectorData[i];
            const twoBits = (b & 0x01 ? 2 : 0) | (b & 0x02 ? 1 : 0); // Reverse 2 low bits
            bit2Buf[bit2Idx] |= (twoBits << shift);

            shift += 2;
            if (shift === 6) {
                shift = 0;
                bit2Idx++;
            }
        }

        // Pack 342 6-bit values and XOR-checksum
        let lastNibble = 0;

        // First output the 86 secondary bytes
        for (let i = 85; i >= 0; i--) {
            const val = bit2Buf[i] & 0x3F;
            const nibble = val ^ lastNibble;
            lastNibble = val;
            outNibbles.push(GCR_WRITE_TABLE[nibble]);
        }

        // Then output the 256 primary 6-bit bytes
        for (let i = 0; i < 256; i++) {
            const val = (sectorData[i] >> 2) & 0x3F;
            const nibble = val ^ lastNibble;
            lastNibble = val;
            outNibbles.push(GCR_WRITE_TABLE[nibble]);
        }

        // Output checksum nibble
        outNibbles.push(GCR_WRITE_TABLE[lastNibble]);
    }

    // Export raw disk image for download/saving
    getRawData() {
        return this.rawDiskData;
    }
}
