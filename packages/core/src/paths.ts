export const paths = {
  user: (uid: string) => `users/${uid}`,
  // Server-only: refresh tokens live here; rules deny every client read.
  gmailState: (uid: string) => `users/${uid}/private/gmail`,
  googleCalendarState: (uid: string) => `users/${uid}/private/googleCalendar`,
  // Per chosen calendar (by a hash of its id): Google event id → iCalendar
  // UID, for events whose UID Google does not derive from their id.
  googleCalendarAliases: (uid: string, calendarKey: string) => `users/${uid}/private/googleCalendarAliases-${calendarKey}`,
  importLock: (uid: string) => `users/${uid}/private/import`,
  // One upload of a kind at a time per user (see apps/parser/src/leases.ts).
  uploadLease: (uid: string, kind: string) => `users/${uid}/private/upload-${kind}`,
  // Embeddings of emails the model has judged, for the similarity pre-filter.
  examples: (uid: string) => `users/${uid}/private/examples`,
  senderPatterns: (uid: string) => `users/${uid}/settings/patterns`,
  // The owner's travel profile; readable by the people they trust with it.
  travelProfile: (uid: string) => `users/${uid}/travelProfile/main`,
  // Subscribed calendar feeds: the owner reads them; the parser writes them.
  feeds: (uid: string) => `users/${uid}/feeds`,
  feed: (uid: string, feedId: string) => `users/${uid}/feeds/${feedId}`,
  // The owner's calendar export link: the owner reads it, the parser
  // alone writes it.
  calendarExport: (uid: string) => `users/${uid}/calendarExport/main`,
  // Server-only: a hash of an export link's token, naming whose it is.
  calendarExportToken: (tokenHash: string) => `calendarExports/${tokenHash}`,
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
