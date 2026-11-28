package app.travelmo.data

import io.kotest.matchers.shouldBe
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertThrows
import org.junit.Test

class ParserClientTest {
    private fun withServer(
        expectedRequests: Int,
        handle: (attempt: Int, socket: Socket, headers: List<String>) -> Unit,
        block: (baseUrl: String) -> Unit,
    ) {
        ServerSocket(0, 8, InetAddress.getLoopbackAddress()).use { server ->
            val worker = thread(name = "parser-client-test-server") {
                for (attempt in 1..expectedRequests) {
                    val socket = try {
                        server.accept()
                    } catch (_: IOException) {
                        break
                    }
                    socket.use { s ->
                        val reader = BufferedReader(InputStreamReader(s.getInputStream()))
                        val headers = mutableListOf<String>()
                        while (true) {
                            val line = reader.readLine() ?: break
                            if (line.isEmpty()) break
                            headers += line
                        }
                        val length = headers.firstOrNull { it.startsWith("Content-Length:", ignoreCase = true) }
                            ?.substringAfter(":")?.trim()?.toIntOrNull() ?: 0
                        if (length > 0) {
                            val body = CharArray(length)
                            var read = 0
                            while (read < length) {
                                val n = reader.read(body, read, length - read)
                                if (n < 0) break
                                read += n
                            }
                        }
                        handle(attempt, s, headers)
                    }
                }
            }
            try {
                block("http://127.0.0.1:${server.localPort}")
            } finally {
                server.close()
                worker.join(5_000)
            }
        }
    }

    private fun writeOk(socket: Socket, body: String) {
        val bytes = body.toByteArray()
        val response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        socket.getOutputStream().apply {
            write(response.toByteArray())
            write(bytes)
            flush()
        }
    }

    @Test
    fun `sends Connection close so idle parser sockets are never pooled`() {
        val seen = CopyOnWriteArrayList<String>()
        withServer(
            expectedRequests = 1,
            handle = { _, socket, headers ->
                seen += headers
                writeOk(socket, """{"changed":0,"deleted":0,"placed":0}""")
            },
        ) { baseUrl ->
            val client = ParserClient(baseUrl, idToken = { "tok" })
            val reply = runBlocking { client.post("/trips/regroup") }
            reply shouldBe ParserReply(200, """{"changed":0,"deleted":0,"placed":0}""")
        }
        seen.any { it.equals("Connection: close", ignoreCase = true) } shouldBe true
    }

    @Test
    fun `retries once on a dropped connection when retryOnDrop is enabled`() {
        val attempts = AtomicInteger(0)
        withServer(
            expectedRequests = 2,
            handle = { attempt, socket, _ ->
                attempts.incrementAndGet()
                if (attempt == 1) {
                    // Send TCP RST to simulate a connection abort mid-flight.
                    socket.setSoLinger(true, 0)
                    socket.close()
                } else {
                    writeOk(socket, """{"changed":1,"deleted":0,"placed":0}""")
                }
            },
        ) { baseUrl ->
            val client = ParserClient(baseUrl, idToken = { "tok" })
            val reply = runBlocking { client.post("/trips/regroup", retryOnDrop = true) }
            reply shouldBe ParserReply(200, """{"changed":1,"deleted":0,"placed":0}""")
        }
        attempts.get() shouldBe 2
    }

    @Test
    fun `does not retry a dropped connection when retryOnDrop is false`() {
        val attempts = AtomicInteger(0)
        withServer(
            expectedRequests = 2,
            handle = { _, socket, _ ->
                attempts.incrementAndGet()
                socket.setSoLinger(true, 0)
                socket.close()
            },
        ) { baseUrl ->
            val client = ParserClient(baseUrl, idToken = { "tok" })
            assertThrows(IOException::class.java) {
                runBlocking { client.post("/trips/start-over", retryOnDrop = false) }
            }
        }
        attempts.get() shouldBe 1
    }
}
