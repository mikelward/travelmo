package app.travelmo.core

import kotlin.math.abs

// Compact, zero-dependency pure KMP ISO/IEC 18004 QR Code encoder (Byte mode,
// EC level M, versions 1..10, up to 213 UTF-8 bytes) for offline scannable
// boarding passes. Mirrors packages/core/src/qr.ts.

private data class QrVersionSpec(
    val version: Int,
    val size: Int,
    val dataBytes: Int,
    val ecPerBlock: Int,
    val blocks: List<Pair<Int, Int>>,
    val align: List<Int>,
)

private val qrVersions = listOf(
    QrVersionSpec(1, 21, 16, 10, listOf(1 to 16), emptyList()),
    QrVersionSpec(2, 25, 28, 16, listOf(1 to 28), listOf(6, 18)),
    QrVersionSpec(3, 29, 44, 26, listOf(1 to 44), listOf(6, 22)),
    QrVersionSpec(4, 33, 64, 18, listOf(2 to 32), listOf(6, 26)),
    QrVersionSpec(5, 37, 86, 24, listOf(2 to 43), listOf(6, 30)),
    QrVersionSpec(6, 41, 108, 16, listOf(4 to 27), listOf(6, 34)),
    QrVersionSpec(7, 45, 124, 18, listOf(4 to 31), listOf(6, 22, 38)),
    QrVersionSpec(8, 49, 154, 22, listOf(2 to 38, 2 to 39), listOf(6, 24, 42)),
    QrVersionSpec(9, 53, 182, 22, listOf(3 to 36, 2 to 37), listOf(6, 26, 46)),
    QrVersionSpec(10, 57, 216, 26, listOf(4 to 43, 1 to 44), listOf(6, 28, 50)),
)

private val gfExp = IntArray(512)
private val gfLog = IntArray(256)

private val gfInit: Unit = run {
    var v = 1
    for (i in 0 until 255) {
        gfExp[i] = v
        gfLog[v] = i
        v = (v shl 1) xor if ((v and 0x80) != 0) 0x11d else 0
    }
    for (i in 255 until 512) gfExp[i] = gfExp[i - 255]
}

private fun gfMul(a: Int, b: Int): Int {
    gfInit
    return if (a == 0 || b == 0) 0 else gfExp[gfLog[a] + gfLog[b]]
}

private fun rsGenerator(degree: Int): IntArray {
    gfInit
    var poly = intArrayOf(1)
    for (i in 0 until degree) {
        val next = IntArray(poly.size + 1)
        val factor = gfExp[i]
        for (j in poly.indices) {
            next[j] = next[j] xor poly[j]
            next[j + 1] = next[j + 1] xor gfMul(poly[j], factor)
        }
        poly = next
    }
    return poly
}

private fun rsRemainder(data: IntArray, ecLen: Int): IntArray {
    val gen = rsGenerator(ecLen)
    val res = IntArray(ecLen)
    for (byte in data) {
        val factor = byte xor res[0]
        for (k in 0 until ecLen - 1) res[k] = res[k + 1]
        res[ecLen - 1] = 0
        for (j in 0 until ecLen) {
            res[j] = res[j] xor gfMul(gen[j + 1], factor)
        }
    }
    return res
}

private fun bchFormat(mask: Int): Int {
    // EC level M = 00 (2 bits) + 3-bit mask.
    val data = mask and 7
    var rem = data shl 10
    for (i in 4 downTo 0) {
        if ((rem and (1 shl (i + 10))) != 0) rem = rem xor (0x537 shl i)
    }
    return ((data shl 10) or rem) xor 0x5412
}

private fun bchVersion(version: Int): Int {
    var rem = version shl 12
    for (i in 5 downTo 0) {
        if ((rem and (1 shl (i + 12))) != 0) rem = rem xor (0x1f25 shl i)
    }
    return (version shl 12) or rem
}

private fun maskBit(mask: Int, r: Int, c: Int): Boolean = when (mask) {
    0 -> (r + c) % 2 == 0
    1 -> r % 2 == 0
    2 -> c % 3 == 0
    3 -> (r + c) % 3 == 0
    4 -> ((r / 2) + (c / 3)) % 2 == 0
    5 -> ((r * c) % 2) + ((r * c) % 3) == 0
    6 -> (((r * c) % 2) + ((r * c) % 3)) % 2 == 0
    else -> (((r + c) % 2) + ((r * c) % 3)) % 2 == 0
}

private fun penalty(grid: Array<BooleanArray>): Int {
    val n = grid.size
    var score = 0
    for (r in 0 until n) {
        var runR = 1
        var runC = 1
        for (i in 1 until n) {
            if (grid[r][i] == grid[r][i - 1]) runR++ else {
                if (runR >= 5) score += 3 + (runR - 5)
                runR = 1
            }
            if (grid[i][r] == grid[i - 1][r]) runC++ else {
                if (runC >= 5) score += 3 + (runC - 5)
                runC = 1
            }
        }
        if (runR >= 5) score += 3 + (runR - 5)
        if (runC >= 5) score += 3 + (runC - 5)
    }
    for (r in 0 until n - 1) {
        for (c in 0 until n - 1) {
            val v = grid[r][c]
            if (v == grid[r][c + 1] && v == grid[r + 1][c] && v == grid[r + 1][c + 1]) score += 3
        }
    }
    return score
}

/**
 * Encodes UTF-8 text into a QR Code matrix (`true` = dark module) using Byte
 * mode and Error Correction Level M (versions 1..10, up to 213 UTF-8 bytes).
 * Returns `null` if empty or too long.
 */
fun encodeQrMatrix(text: String): List<List<Boolean>>? {
    if (text.isEmpty()) return null
    val payload = text.encodeToByteArray()
    val spec = qrVersions.firstOrNull { v ->
        val countBits = if (v.version < 10) 8 else 16
        4 + countBits + payload.size * 8 <= v.dataBytes * 8
    } ?: return null

    val bits = mutableListOf<Int>()
    fun pushBits(value: Int, len: Int) {
        for (i in len - 1 downTo 0) bits += (value ushr i) and 1
    }
    pushBits(0b0100, 4)
    pushBits(payload.size, if (spec.version < 10) 8 else 16)
    for (b in payload) pushBits(b.toInt() and 0xff, 8)
    val capBits = spec.dataBytes * 8
    pushBits(0, minOf(4, capBits - bits.size))
    while (bits.size % 8 != 0) bits += 0

    val data = IntArray(spec.dataBytes)
    val usedBytes = bits.size / 8
    for (i in 0 until usedBytes) {
        var byte = 0
        for (b in 0 until 8) byte = (byte shl 1) or bits[i * 8 + b]
        data[i] = byte
    }
    val padBytes = intArrayOf(0xec, 0x11)
    var p = 0
    for (i in usedBytes until spec.dataBytes) {
        data[i] = padBytes[p]
        p = 1 - p
    }

    val dataBlocks = mutableListOf<IntArray>()
    val ecBlocks = mutableListOf<IntArray>()
    var offset = 0
    for ((count, len) in spec.blocks) {
        repeat(count) {
            val slice = data.copyOfRange(offset, offset + len)
            offset += len
            dataBlocks += slice
            ecBlocks += rsRemainder(slice, spec.ecPerBlock)
        }
    }

    val codewords = mutableListOf<Int>()
    val maxDataLen = dataBlocks.maxOf { it.size }
    for (i in 0 until maxDataLen) {
        for (blk in dataBlocks) if (i < blk.size) codewords += blk[i]
    }
    for (i in 0 until spec.ecPerBlock) {
        for (blk in ecBlocks) codewords += blk[i]
    }

    val n = spec.size
    val base = Array(n) { BooleanArray(n) }
    val fixed = Array(n) { BooleanArray(n) }
    fun setFixed(r: Int, c: Int, dark: Boolean) {
        if (r in 0 until n && c in 0 until n) {
            base[r][c] = dark
            fixed[r][c] = true
        }
    }

    fun placeFinder(tr: Int, tc: Int) {
        for (dr in -1..7) {
            for (dc in -1..7) {
                val dark = dr in 0..6 && dc in 0..6 &&
                    (dr == 0 || dr == 6 || dc == 0 || dc == 6 || (dr in 2..4 && dc in 2..4))
                setFixed(tr + dr, tc + dc, dark)
            }
        }
    }
    placeFinder(0, 0)
    placeFinder(0, n - 7)
    placeFinder(n - 7, 0)

    for (i in 8 until n - 8) {
        setFixed(6, i, i % 2 == 0)
        setFixed(i, 6, i % 2 == 0)
    }

    if (spec.align.size >= 2) {
        val first = spec.align.first()
        val last = spec.align.last()
        for (r in spec.align) {
            for (c in spec.align) {
                if ((r == first && c == first) || (r == first && c == last) || (r == last && c == first)) continue
                for (dr in -2..2) {
                    for (dc in -2..2) {
                        setFixed(r + dr, c + dc, maxOf(abs(dr), abs(dc)) != 1)
                    }
                }
            }
        }
    }

    setFixed(4 * spec.version + 9, 8, true)
    for (i in 0 until 9) {
        if (!fixed[8][i]) setFixed(8, i, false)
        if (!fixed[i][8]) setFixed(i, 8, false)
    }
    for (i in 0 until 8) {
        if (!fixed[8][n - 1 - i]) setFixed(8, n - 1 - i, false)
        if (!fixed[n - 1 - i][8]) setFixed(n - 1 - i, 8, false)
    }

    if (spec.version >= 7) {
        val vBits = bchVersion(spec.version)
        for (i in 0 until 18) {
            val dark = ((vBits ushr i) and 1) == 1
            val a = i / 3
            val b = n - 11 + (i % 3)
            setFixed(a, b, dark)
            setFixed(b, a, dark)
        }
    }

    var bitIdx = 0
    val totalBits = codewords.size * 8
    var right = n - 1
    while (right >= 1) {
        if (right == 6) right = 5
        val upward = ((n - 1 - right) / 2) % 2 == 0
        for (step in 0 until n) {
            val r = if (upward) n - 1 - step else step
            for (dx in 0..1) {
                val c = right - dx
                if (fixed[r][c]) continue
                val dark = if (bitIdx < totalBits) ((codewords[bitIdx ushr 3] ushr (7 - (bitIdx and 7))) and 1) == 1 else false
                base[r][c] = dark
                bitIdx++
            }
        }
        right -= 2
    }

    var bestGrid = base
    var bestScore = Int.MAX_VALUE
    for (mask in 0..7) {
        val grid = Array(n) { r ->
            BooleanArray(n) { c ->
                val v = base[r][c]
                if (fixed[r][c]) v else if (maskBit(mask, r, c)) !v else v
            }
        }
        val fmt = bchFormat(mask)
        for (i in 0..5) grid[8][i] = ((fmt ushr (14 - i)) and 1) == 1
        grid[8][7] = ((fmt ushr 8) and 1) == 1
        grid[8][8] = ((fmt ushr 7) and 1) == 1
        grid[7][8] = ((fmt ushr 6) and 1) == 1
        for (i in 0..5) grid[5 - i][8] = ((fmt ushr (5 - i)) and 1) == 1
        for (i in 0..7) grid[8][n - 1 - i] = ((fmt ushr i) and 1) == 1
        for (i in 0..6) grid[n - 1 - i][8] = ((fmt ushr (14 - i)) and 1) == 1

        val s = penalty(grid)
        if (s < bestScore) {
            bestScore = s
            bestGrid = grid
        }
    }
    return bestGrid.map { it.toList() }
}
