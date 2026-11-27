package app.travelmo.ui

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import app.travelmo.logging.SharedLog
import app.travelmo.logging.safe
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/**
 * Emits whenever the device gains a validated internet connection, so screens
 * holding unconfirmed offline reads can refresh without leaving the screen.
 */
internal fun networkReconnected(context: Context): Flow<Unit> = callbackFlow {
    val cm = context.getSystemService(ConnectivityManager::class.java)
    if (cm == null) {
        awaitClose {}
        return@callbackFlow
    }
    var validated = false
    val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            val nowValidated = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            if (nowValidated && !validated) trySend(Unit)
            validated = nowValidated
        }

        override fun onLost(network: Network) {
            validated = false
        }
    }
    try {
        cm.registerDefaultNetworkCallback(callback)
    } catch (e: Exception) {
        SharedLog.error(e, "Watching network changes failed")
        awaitClose {}
        return@callbackFlow
    }
    awaitClose {
        try {
            cm.unregisterNetworkCallback(callback)
        } catch (e: Exception) {
            // Already unregistered or system rejected cleanup.
            SharedLog.debug("Unregistering network callback failed: %s", safe(e::class.simpleName))
        }
    }
}
