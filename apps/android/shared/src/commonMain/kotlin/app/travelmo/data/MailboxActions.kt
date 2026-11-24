package app.travelmo.data



/** Settings' Gmail section: connecting, and reading each connected mailbox; the parser in the app, a fake in tests. */
interface GmailActions {
    /** False on a build with no parser address, where Settings sends the user to the web. */
    val available: Boolean

    /** Google's consent page for read-only Gmail access, to open in the browser. Throws [TripActionFailed]. */
    suspend fun connectUrl(): String

    /** Starts or continues reading the past emails of the mailbox at [emailAddress]; from the start with [restart]. Throws [TripActionFailed]. */
    suspend fun start(emailAddress: String, restart: Boolean)

    /** Stops that mailbox's reading where it got to. Throws [TripActionFailed]. */
    suspend fun stop(emailAddress: String)

    /** Disconnects that mailbox. Throws [TripActionFailed]. */
    suspend fun disconnect(emailAddress: String)
}

/** Settings' Fastmail section: connecting with an API token, and reading the mailbox; the parser in the app, a fake in tests. */
interface FastmailActions {
    /** False on a build with no parser address, where Settings sends the user to the web. */
    val available: Boolean

    /** Connects the mailbox a read-only Fastmail API token reads. Throws [TripActionFailed] with the parser's words when it refuses the token. */
    suspend fun connect(token: String)

    /** Starts or continues reading past emails; from the start with [restart]. Throws [TripActionFailed]. */
    suspend fun start(restart: Boolean)

    /** Stops the reading where it got to. Throws [TripActionFailed]. */
    suspend fun stop()

    /** Disconnects Fastmail. Throws [TripActionFailed]. */
    suspend fun disconnect()
}

/** Settings' IMAP section: connecting a mailbox with an app password, and reading each; the parser in the app, a fake in tests. */
interface ImapActions {
    /** False on a build with no parser address, where Settings sends the user to the web. */
    val available: Boolean

    /**
     * Connects the mailbox at [emailAddress] with an app password made with its provider; [server] only for a
     * provider Travelmo does not know. Throws [TripActionFailed] with the parser's words when the server refuses.
     */
    suspend fun connect(emailAddress: String, password: String, server: String?)

    /** Starts or continues reading the past emails of the mailbox at [emailAddress]; from the start with [restart]. Throws [TripActionFailed]. */
    suspend fun start(emailAddress: String, restart: Boolean)

    /** Stops that mailbox's reading where it got to. Throws [TripActionFailed]. */
    suspend fun stop(emailAddress: String)

    /** Disconnects that mailbox. Throws [TripActionFailed]. */
    suspend fun disconnect(emailAddress: String)
}

/** A build with no parser address: every action is for Settings on the web. */
private fun onWeb(): Nothing = throw TripActionFailed("Use Settings on the web for this.")

object NoGmailActions : GmailActions {
    override val available = false
    override suspend fun connectUrl(): String = onWeb()
    override suspend fun start(emailAddress: String, restart: Boolean) = onWeb()
    override suspend fun stop(emailAddress: String) = onWeb()
    override suspend fun disconnect(emailAddress: String) = onWeb()
}

object NoImapActions : ImapActions {
    override val available = false
    override suspend fun connect(emailAddress: String, password: String, server: String?) = onWeb()
    override suspend fun start(emailAddress: String, restart: Boolean) = onWeb()
    override suspend fun stop(emailAddress: String) = onWeb()
    override suspend fun disconnect(emailAddress: String) = onWeb()
}

object NoFastmailActions : FastmailActions {
    override val available = false
    override suspend fun connect(token: String) = onWeb()
    override suspend fun start(restart: Boolean) = onWeb()
    override suspend fun stop() = onWeb()
    override suspend fun disconnect() = onWeb()
}
