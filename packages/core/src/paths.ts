export const paths = {
  user: (uid: string) => `users/${uid}`,
  // Who may use the app (access.ts): one record per lowercased email, and
  // the admins' list, written by hand in the console.
  accessRecords: () => "access",
  access: (email: string) => `access/${email}`,
  accessConfig: () => "config/access",
  // Server-only: when the parser last recorded the accounts from before
  // approvals (apps/parser/src/access.ts's grandfatherAccounts).
  accessGrandfathered: () => "config/accessGrandfathered",
  // Server-only: written first when an account is deleted and kept, so an
  // import already under way cannot recreate the user's data (holds the uid
  // and when; Firebase never reuses a uid).
  deletedAccount: (uid: string) => `deletedAccounts/${uid}`,
  // Server-only: refresh tokens live here; rules deny every client read.
  // One per connected Gmail mailbox, by its key (gmail.ts's mailboxKey).
  gmailMailbox: (uid: string, key: string) => `users/${uid}/private/gmail-${key}`,
  // The one mailbox connected before there could be several, until the
  // parser moves it to `gmailMailbox` (apps/parser/src/connections.ts).
  gmailState: (uid: string) => `users/${uid}/private/gmail`,
  // `first`: the mailbox whose emails are recorded under Gmail's bare
  // message ids (the account's first, for good: gmail.ts's gmailIdPrefix).
  gmailIds: (uid: string) => `users/${uid}/private/gmailIds`,
  fastmailState: (uid: string) => `users/${uid}/private/fastmail`,
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
  parsedMessages: (uid: string) => `users/${uid}/parsedMessages`,
  parsedMessage: (uid: string, messageId: string) =>
    `users/${uid}/parsedMessages/${messageId}`,
  pendingCancellations: (uid: string) => `users/${uid}/pendingCancellations`,
  pendingCancellation: (uid: string, messageId: string) => `users/${uid}/pendingCancellations/${messageId}`,
  gmailAccount: (emailAddress: string) => `gmailAccounts/${emailAddress}`,
  // Server-only: which account a confirmed address is linked to, one each
  // (emails.ts), and the account's unconfirmed links' token hashes and the
  // confirmation emails it sent today.
  linkedEmail: (email: string) => `linkedEmails/${email}`,
  emailLinks: (uid: string) => `users/${uid}/private/emails`,
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
  // A flight's live gates and carousel, one per flight (flightStatusKey):
  // any signed-in client may read one it names; the parser alone writes.
  flightStatus: (key: string) => `flightStatus/${key}`,
  // Who is looking at a flight now, so overlapping looks make one call.
  flightStatusClaim: (key: string) => `flightStatusClaims/${key}`,
  // Flight news no browser or phone of a person took yet, to try again.
  flightStatusNews: () => "flightStatusNews",
  flightStatusNewsEntry: (id: string) => `flightStatusNews/${id}`,
  // Flight-status calls per day across every user, against the daily cap.
  flightStatusBudget: (day: string) => `flightStatusBudget/${day}`,
  // Who has been reminded that a booking's online check-in is open, one per
  // booking (`<ownerUid>__<segmentId>`); the parser's alone.
  checkInReminders: () => "checkInReminders",
  checkInReminder: (id: string) => `checkInReminders/${id}`,
  // The user's reminders before every international trip, one per slot
  // (checklist.ts), and their own state for a trip's reminders: what they
  // ticked off and the one-offs they added to it. Theirs alone.
  tripReminders: (uid: string) => `users/${uid}/tripReminders`,
  tripReminder: (uid: string, slot: string) => `users/${uid}/tripReminders/${slot}`,
  tripChecklists: (uid: string) => `users/${uid}/tripChecklists`,
  tripChecklist: (uid: string, tripId: string) => `users/${uid}/tripChecklists/${tripId}`,
  tripChecklistAdded: (uid: string, tripId: string) => `users/${uid}/tripChecklists/${tripId}/added`,
  tripChecklistAddedSlot: (uid: string, tripId: string, slot: string) => `users/${uid}/tripChecklists/${tripId}/added/${slot}`,
  // Whether a reminder before a trip went to its user, one per user, trip
  // and reminder (`<uid>__<tripId>__<reminderId>`); the parser's alone.
  checklistReminders: () => "checklistReminders",
  checklistReminder: (id: string) => `checklistReminders/${id}`,
} as const;
