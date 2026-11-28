package app.travelmo.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class QrCodeTest {
    @Test
    fun encodesIataBcbpPayloadIntoValidSquareQrMatrix() {
        val bcbp = "M1EXAMPLE/SAM        E4K8M2P MANDOHQR 0022 332Y014A0042 100"
        val matrix = encodeQrMatrix(bcbp)
        assertNotNull(matrix)
        assertEquals(33, matrix.size)
        assertTrue(matrix.all { it.size == 33 })
        assertEquals(listOf(true, true, true, true, true, true, true), matrix[0].subList(0, 7))
        assertEquals(listOf(true, false, false, false, false, false, true), matrix[1].subList(0, 7))
        assertTrue(matrix[3][3])
    }

    @Test
    fun preservesAlignmentPatternsIntersectingTimingPatternsForVersion7Plus() {
        val matrix = encodeQrMatrix("A".repeat(110))
        assertNotNull(matrix)
        assertEquals(45, matrix.size)
        for ((r, c) in listOf(6 to 22, 22 to 6)) {
            assertTrue(matrix[r][c])
            assertEquals(false, matrix[r - 1][c - 1])
            assertEquals(false, matrix[r + 1][c + 1])
            assertTrue(matrix[r - 2][c - 2])
            assertTrue(matrix[r + 2][c + 2])
        }
    }

    @Test
    fun returnsNullForEmptyOrOversizedInput() {
        assertNull(encodeQrMatrix(""))
        assertNull(encodeQrMatrix("x".repeat(300)))
    }
}
