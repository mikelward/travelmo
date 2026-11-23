package app.travelmo.core

import kotlin.math.abs
import kotlin.math.floor

// Text and hashing that java.text and java.security gave the JVM, written
// out so every platform answers alike.

/**
 * [value] with three decimals, rounding half up on its shortest decimal
 * form, as Java's "%.3f" does: 51.4775 is "51.478".
 */
internal fun fixed3(value: Double): String {
    require(value.isFinite()) { "Not a finite number: $value" }
    val negative = value < 0 || (value == 0.0 && 1.0 / value < 0)
    var text = abs(value).toString()
    var exponent = 0
    val e = text.indexOfFirst { it == 'E' || it == 'e' }
    if (e >= 0) {
        exponent = text.substring(e + 1).toInt()
        text = text.substring(0, e)
    }
    val dot = text.indexOf('.')
    var digits = if (dot >= 0) text.removeRange(dot, dot + 1) else text
    // How many of the digits come before the decimal point.
    var whole = (if (dot >= 0) dot else text.length) + exponent
    if (whole < 0) {
        digits = "0".repeat(-whole) + digits
        whole = 0
    }
    val kept = whole + 3
    digits = digits.padEnd(kept + 1, '0')
    val rounded = StringBuilder(digits.substring(0, kept))
    if (digits[kept] >= '5') {
        var i = rounded.length - 1
        while (i >= 0 && rounded[i] == '9') rounded[i--] = '0'
        if (i >= 0) rounded[i] = rounded[i] + 1 else rounded.insert(0, '1')
    }
    val number = rounded.toString().padStart(4, '0')
    val integer = number.dropLast(3).trimStart('0').ifEmpty { "0" }
    return "${if (negative) "-" else ""}$integer.${number.takeLast(3)}"
}

/** "1234567" as "1,234,567", as en-US writes it. */
internal fun groupThousands(value: Long): String {
    val digits = value.toString().removePrefix("-")
    val grouped = digits.reversed().chunked(3).joinToString(",").reversed()
    return if (value < 0) "-$grouped" else grouped
}

/** The nearest whole number, halves up, as Java's Math.round: 2.5 is 3, -2.5 is -2. */
internal fun roundHalfUp(value: Double): Long = floor(value + 0.5).toLong()

private val roundConstants = intArrayOf(
    0x428a2f98, 0x71374491, -0x4a3f0431, -0x164a245b, 0x3956c25b, 0x59f111f1, -0x6dc07d5c, -0x54e3a12b,
    -0x27f85568, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, -0x7f214e02, -0x6423f959, -0x3e640e8c,
    -0x1b64963f, -0x1041b87a, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    -0x67c1aeae, -0x57ce3993, -0x4ffcd838, -0x40a68039, -0x391ff40d, -0x2a586eb9, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, -0x7e3d36d2, -0x6d8dd37b,
    -0x5d40175f, -0x57e599b5, -0x3db47490, -0x3893ae5d, -0x2e6d17e7, -0x2966f9dc, -0xbf1ca7b, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, -0x7b3787ec, -0x7338fdf8, -0x6f410006, -0x5baf9315, -0x41065c09, -0x398e870e,
)

/** The SHA-256 digest of [input] (FIPS 180-4). */
internal fun sha256(input: ByteArray): ByteArray {
    val h = intArrayOf(0x6a09e667, -0x4498517b, 0x3c6ef372, -0x5ab00ac6, 0x510e527f, -0x64fa9774, 0x1f83d9ab, 0x5be0cd19)
    // The message, a 1 bit, zeros, and its length in bits, to a multiple of 64 bytes.
    val padded = ByteArray(((input.size + 8) / 64 + 1) * 64)
    input.copyInto(padded)
    padded[input.size] = 0x80.toByte()
    val bits = input.size.toLong() * 8
    for (i in 0 until 8) padded[padded.size - 1 - i] = (bits ushr (8 * i)).toByte()
    val w = IntArray(64)
    for (block in padded.indices step 64) {
        for (t in 0 until 16) {
            val o = block + t * 4
            w[t] = (padded[o].toInt() and 0xFF shl 24) or (padded[o + 1].toInt() and 0xFF shl 16) or
                (padded[o + 2].toInt() and 0xFF shl 8) or (padded[o + 3].toInt() and 0xFF)
        }
        for (t in 16 until 64) {
            val s0 = w[t - 15].rotateRight(7) xor w[t - 15].rotateRight(18) xor (w[t - 15] ushr 3)
            val s1 = w[t - 2].rotateRight(17) xor w[t - 2].rotateRight(19) xor (w[t - 2] ushr 10)
            w[t] = w[t - 16] + s0 + w[t - 7] + s1
        }
        var (a, b, c, d) = h
        var e = h[4]
        var f = h[5]
        var g = h[6]
        var hh = h[7]
        for (t in 0 until 64) {
            val s1 = e.rotateRight(6) xor e.rotateRight(11) xor e.rotateRight(25)
            val ch = (e and f) xor (e.inv() and g)
            val t1 = hh + s1 + ch + roundConstants[t] + w[t]
            val s0 = a.rotateRight(2) xor a.rotateRight(13) xor a.rotateRight(22)
            val maj = (a and b) xor (a and c) xor (b and c)
            val t2 = s0 + maj
            hh = g
            g = f
            f = e
            e = d + t1
            d = c
            c = b
            b = a
            a = t1 + t2
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh
    }
    return ByteArray(32) { i -> (h[i / 4] ushr (24 - 8 * (i % 4))).toByte() }
}
