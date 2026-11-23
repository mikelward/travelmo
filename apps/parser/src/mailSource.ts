import { backfillBatch, backfillQuery } from "./backfill";
import {
  fetchMessage,
  gmailUnits,
  isBadRequest,
  isNotFound,
  searchMessagePage,
  type EmailMessage,
  type Gmail,
  type MessagePage,
} from "./gmail";

// A mailbox the import reads, whoever hosts it: the backfill pages through
// its booking-like mail, and every import fetches a message by id. Each
// provider (Gmail today) implements it; how new mail is noticed stays the
// provider's own (Gmail's push notifications).
export type MailSource = {
  // Up to a batch of booking-like message ids from `cursor` on, and where
  // to carry on from; no nextPageToken once the search is exhausted.
  searchPage: (cursor: string | undefined) => Promise<MessagePage>;
  fetch: (id: string) => Promise<EmailMessage>;
  // An error saying the cursor is no longer honored, so the reading starts
  // over.
  isStaleCursor: (error: unknown) => boolean;
  // An error saying the message is gone from the mailbox.
  isNotFound: (error: unknown) => boolean;
};

// Spends a call's share of the provider's quota before making it.
export type Pace = (units: number) => Promise<void>;

const unpaced: Pace = async () => {};

export function gmailSource(gmail: Gmail, pace: Pace = unpaced): MailSource {
  return {
    searchPage: async (cursor) => {
      await pace(gmailUnits.list);
      return searchMessagePage(gmail, backfillQuery, backfillBatch, cursor);
    },
    fetch: async (id) => {
      await pace(gmailUnits.getFull);
      return fetchMessage(gmail, id);
    },
    isStaleCursor: isBadRequest,
    isNotFound,
  };
}
