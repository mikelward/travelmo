package app.travelmo.core

import java.security.MessageDigest

// Reminders as notifications on this phone: the parser (apps/parser/src/fcm.ts)
// sends one Cloud Messaging message per trip with news to every token the
// app registered under the user (users/{uid}/devices/{id}), carrying the
// trip's web URL as the tap target.

/**
 * The document id for a registration token: a hash, so a token is never a
 * document name, and the same from any run, so re-registering writes one
 * document. SHA-256, the first 32 hex characters.
 */
fun deviceId(token: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it) }.take(32)
}

private val tripUrl = Regex("""/trips/([A-Za-z0-9_-]+)(?:[/?#]|$)""")

/** The trip a reminder's URL points at (`https://<web>/trips/<id>`), or null for anything else. */
fun tripIdFromReminderUrl(url: String?): String? = url?.let { tripUrl.find(it)?.groupValues?.get(1) }
