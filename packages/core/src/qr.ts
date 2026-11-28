// Compact, zero-dependency ISO/IEC 18004 QR Code encoder (Byte mode, EC level M,
// versions 1..10, up to 213 UTF-8 bytes) for offline scannable boarding passes.
// Mirrored in apps/android/core/src/commonMain/kotlin/app/travelmo/core/QrCode.kt.

type VersionSpec = {
  version: number;
  size: number;
  dataBytes: number;
  ecPerBlock: number;
  blocks: readonly [count: number, dataLen: number][];
  align: readonly number[];
};

// Error Correction Level M parameters for QR versions 1..10.
const versions: readonly VersionSpec[] = [
  { version: 1, size: 21, dataBytes: 16, ecPerBlock: 10, blocks: [[1, 16]], align: [] },
  { version: 2, size: 25, dataBytes: 28, ecPerBlock: 16, blocks: [[1, 28]], align: [6, 18] },
  { version: 3, size: 29, dataBytes: 44, ecPerBlock: 26, blocks: [[1, 44]], align: [6, 22] },
  { version: 4, size: 33, dataBytes: 64, ecPerBlock: 18, blocks: [[2, 32]], align: [6, 26] },
  { version: 5, size: 37, dataBytes: 86, ecPerBlock: 24, blocks: [[2, 43]], align: [6, 30] },
  { version: 6, size: 41, dataBytes: 108, ecPerBlock: 16, blocks: [[4, 27]], align: [6, 34] },
  { version: 7, size: 45, dataBytes: 124, ecPerBlock: 18, blocks: [[4, 31]], align: [6, 22, 38] },
  { version: 8, size: 49, dataBytes: 154, ecPerBlock: 22, blocks: [[2, 38], [2, 39]], align: [6, 24, 42] },
  { version: 9, size: 53, dataBytes: 182, ecPerBlock: 22, blocks: [[3, 36], [2, 37]], align: [6, 26, 46] },
  { version: 10, size: 57, dataBytes: 216, ecPerBlock: 26, blocks: [[4, 43], [1, 44]], align: [6, 28, 50] },
];

// GF(256) exp/log tables with primitive polynomial 0x11d.
const gfExp = new Uint8Array(512);
const gfLog = new Uint8Array(256);
{
  let v = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = v;
    gfLog[v] = i;
    v = (v << 1) ^ (v & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255]!;
}

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : gfExp[gfLog[a]! + gfLog[b]!]!;
}

function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = gfExp[i]!;
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] ?? 0) ^ poly[j]!;
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(poly[j]!, factor);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(ecLen);
  for (const byte of data) {
    const factor = byte ^ res[0]!;
    res.copyWithin(0, 1);
    res[ecLen - 1] = 0;
    for (let j = 0; j < ecLen; j++) {
      res[j] = (res[j] ?? 0) ^ gfMul(gen[j + 1]!, factor);
    }
  }
  return res;
}

function bchFormat(mask: number): number {
  // EC level M = 00 (2 bits) + 3-bit mask.
  const data = (0b00 << 3) | mask;
  let rem = data << 10;
  for (let i = 4; i >= 0; i--) {
    if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function bchVersion(version: number): number {
  let rem = version << 12;
  for (let i = 5; i >= 0; i--) {
    if (rem & (1 << (i + 12))) rem ^= 0x1f25 << i;
  }
  return (version << 12) | rem;
}

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function penalty(grid: boolean[][]): number {
  const n = grid.length;
  let score = 0;
  for (let r = 0; r < n; r++) {
    let runR = 1;
    let runC = 1;
    for (let i = 1; i < n; i++) {
      if (grid[r]![i] === grid[r]![i - 1]) runR++;
      else { if (runR >= 5) score += 3 + (runR - 5); runR = 1; }
      if (grid[i]![r] === grid[i - 1]![r]) runC++;
      else { if (runC >= 5) score += 3 + (runC - 5); runC = 1; }
    }
    if (runR >= 5) score += 3 + (runR - 5);
    if (runC >= 5) score += 3 + (runC - 5);
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = grid[r]![c];
      if (v === grid[r]![c + 1] && v === grid[r + 1]![c] && v === grid[r + 1]![c + 1]) score += 3;
    }
  }
  return score;
}

/**
 * Encodes UTF-8 text into a QR Code matrix (`true` = dark module) using Byte
 * mode and Error Correction Level M (versions 1..10, up to 213 UTF-8 bytes).
 * Returns `undefined` if empty or too long.
 */
export function encodeQrMatrix(text: string): boolean[][] | undefined {
  if (!text) return undefined;
  const payload = new TextEncoder().encode(text);
  const spec = versions.find((v) => {
    const countBits = v.version < 10 ? 8 : 16;
    return 4 + countBits + payload.length * 8 <= v.dataBytes * 8;
  });
  if (!spec) return undefined;

  // Build bit stream: Byte mode (0100), length, payload, terminator, pad bytes.
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(payload.length, spec.version < 10 ? 8 : 16);
  for (const b of payload) pushBits(b, 8);
  const capBits = spec.dataBytes * 8;
  pushBits(0, Math.min(4, capBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(spec.dataBytes);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b]!;
    data[i] = byte;
  }
  const padBytes = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < spec.dataBytes; i++, p = 1 - p) {
    data[i] = padBytes[p]!;
  }

  // Split into RS blocks and interleave data + EC codewords.
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const [count, len] of spec.blocks) {
    for (let i = 0; i < count; i++) {
      const slice = data.slice(offset, offset + len);
      offset += len;
      dataBlocks.push(slice);
      ecBlocks.push(rsRemainder(slice, spec.ecPerBlock));
    }
  }

  const codewords: number[] = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) if (i < blk.length) codewords.push(blk[i]!);
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const blk of ecBlocks) codewords.push(blk[i]!);
  }

  const n = spec.size;
  const base: boolean[][] = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  const fixed: boolean[][] = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  const setFixed = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < n && c >= 0 && c < n) {
      base[r]![c] = dark;
      fixed[r]![c] = true;
    }
  };

  // Finder patterns + separators.
  const placeFinder = (tr: number, tc: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const dark =
          dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setFixed(tr + dr, tc + dc, dark);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, n - 7);
  placeFinder(n - 7, 0);

  // Timing patterns.
  for (let i = 8; i < n - 8; i++) {
    setFixed(6, i, i % 2 === 0);
    setFixed(i, 6, i % 2 === 0);
  }

  // Alignment patterns (skip only the three corners that overlap finder patterns,
  // preserving alignment patterns centered on timing row/col 6 for versions 7..10).
  if (spec.align.length >= 2) {
    const first = spec.align[0]!;
    const last = spec.align[spec.align.length - 1]!;
    for (const r of spec.align) {
      for (const c of spec.align) {
        if ((r === first && c === first) || (r === first && c === last) || (r === last && c === first)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setFixed(r + dr, c + dc, dark);
          }
        }
      }
    }
  }

  // Dark module & reserve format info strips.
  setFixed(4 * spec.version + 9, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!fixed[8]![i]) setFixed(8, i, false);
    if (!fixed[i]![8]) setFixed(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!fixed[8]![n - 1 - i]) setFixed(8, n - 1 - i, false);
    if (!fixed[n - 1 - i]![8]) setFixed(n - 1 - i, 8, false);
  }

  // Version info (versions 7..10).
  if (spec.version >= 7) {
    const vBits = bchVersion(spec.version);
    for (let i = 0; i < 18; i++) {
      const dark = ((vBits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = n - 11 + (i % 3);
      setFixed(a, b, dark);
      setFixed(b, a, dark);
    }
  }

  // Place data bits in upward/downward 2-column zig-zag.
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = Math.floor((n - 1 - right) / 2) % 2 === 0;
    for (let step = 0; step < n; step++) {
      const r = upward ? n - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = right - dx;
        if (fixed[r]![c]) continue;
        const dark = bitIdx < totalBits ? (((codewords[bitIdx >>> 3]! >>> (7 - (bitIdx & 7))) & 1) === 1) : false;
        base[r]![c] = dark;
        bitIdx++;
      }
    }
  }

  // Evaluate all 8 masks and pick the lowest penalty.
  let bestGrid = base;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const grid = base.map((row, r) =>
      row.map((val, c) => (fixed[r]![c] ? val : maskBit(mask, r, c) ? !val : val)),
    );
    const fmt = bchFormat(mask);
    for (let i = 0; i <= 5; i++) grid[8]![i] = ((fmt >>> (14 - i)) & 1) === 1;
    grid[8]![7] = ((fmt >>> 8) & 1) === 1;
    grid[8]![8] = ((fmt >>> 7) & 1) === 1;
    grid[7]![8] = ((fmt >>> 6) & 1) === 1;
    for (let i = 0; i <= 5; i++) grid[5 - i]![8] = ((fmt >>> (5 - i)) & 1) === 1;
    for (let i = 0; i < 8; i++) grid[8]![n - 1 - i] = ((fmt >>> i) & 1) === 1;
    for (let i = 0; i < 7; i++) grid[n - 1 - i]![8] = ((fmt >>> (14 - i)) & 1) === 1;

    const s = penalty(grid);
    if (s < bestScore) {
      bestScore = s;
      bestGrid = grid;
    }
  }
  return bestGrid;
}
