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
  // Server-only: a hash of a forwarding address's token, naming whose it is.
  forwardAddress: (tokenHash: string) => `forwardAddresses/${tokenHash}`,
  // Server-only: how many forwarded emails the user sent today.
  forwardBudget: (uid: string) => `users/${uid}/private/forwardBudget`,
  parsedMessage: (uid: string, messageId: string) =>
    `users/${uid}/parsedMessages/${messageId}`,
  gmailAccount: (emailAddress: string) => `gmailAccounts/${emailAddress}`,
  oauthState: (nonce: string) => `oauthStates/${nonce}`,
  pendingConnection: (token: string) => `pendingConnections/${token}`,
  // The geocoder's answers, shared by every user, and its calls per day.
  geocode: (key: string) => `geocodes/${key}`,
  geocodeBudget: (day: string) => `geocodeBudget/${day}`,
  // Which reminder lines a user was mailed for a trip: the parser's alone.
  reminderLog: (uid: string, tripId: string) => `users/${uid}/reminders/${tripId}`,
  pushSubscriptions: (uid: string) => `users/${uid}/pushSubscriptions`,
  pushSubscription: (uid: string, id: string) => `users/${uid}/pushSubscriptions/${id}`,
  // Phones registered for reminders as notifications, written by the app.
  devices: (uid: string) => `users/${uid}/devices`,
  device: (uid: string, id: string) => `users/${uid}/devices/${id}`,
  // Bookings a spent budget left with a place to ask about another day.
  geocodeRetries: () => "geocodeRetries",
  geocodeRetry: (tripId: string, segmentId: string) => `geocodeRetries/${tripId}__${segmentId}`,
  trips: () => "trips",
  trip: (tripId: string) => `trips/${tripId}`,
  segments: (tripId: string) => `trips/${tripId}/segments`,
  segment: (tripId: string, segmentId: string) =>
    `trips/${tripId}/segments/${segmentId}`,
} as const;
