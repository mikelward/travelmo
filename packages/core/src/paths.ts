export const paths = {
  user: (uid: string) => `users/${uid}`,
  // Server-only: refresh tokens live here; rules deny every client read.
  gmailState: (uid: string) => `users/${uid}/private/gmail`,
  googleCalendarState: (uid: string) => `users/${uid}/private/googleCalendar`,
  // Per chosen calendar (by a hash of its id): Google event id → iCalendar
  // UID, for events whose UID Google does not derive from their id.
  googleCalendarAliases: (uid: string, calendarKey: string) => `users/${uid}/private/googleCalendarAliases-${calendarKey}`,
  importLock: (uid: string) => `users/${uid}/private/import`,
  // Embeddings of emails the model has judged, for the similarity pre-filter.
  examples: (uid: string) => `users/${uid}/private/examples`,
  senderPatterns: (uid: string) => `users/${uid}/settings/patterns`,
  // Subscribed calendar feeds: the owner reads them; the parser writes them.
  feeds: (uid: string) => `users/${uid}/feeds`,
  feed: (uid: string, feedId: string) => `users/${uid}/feeds/${feedId}`,
  parsedMessage: (uid: string, messageId: string) =>
    `users/${uid}/parsedMessages/${messageId}`,
  gmailAccount: (emailAddress: string) => `gmailAccounts/${emailAddress}`,
  oauthState: (nonce: string) => `oauthStates/${nonce}`,
  pendingConnection: (token: string) => `pendingConnections/${token}`,
  trips: () => "trips",
  trip: (tripId: string) => `trips/${tripId}`,
  segments: (tripId: string) => `trips/${tripId}/segments`,
  segment: (tripId: string, segmentId: string) =>
    `trips/${tripId}/segments/${segmentId}`,
} as const;
