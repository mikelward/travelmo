# Import methods

How trips can get into Travelmo, compared. "Built" means it works today; the rest
is the roadmap in `TODO.md`. Every method ends in the same place: an
`ExtractedBooking` per reservation, filed into a trip by its dates (`SPEC.md`,
"Import pipeline"), with a stable source id so a second import changes nothing.

## Overview

| Method | Status | What arrives | How far back | Freshness | Getting it | Needs |
|---|---|---|---|---|---|---|
| Gmail push | Built | Each new email that passes the pre-filter, read by the model | Forward from connection | Near-realtime (Pub/Sub watch, renewed daily) | One OAuth consent in Settings | Google OAuth client with the Gmail read scope; app verification for public use |
| Gmail backfill | Built | Past emails matching a booking-like search | The whole mailbox, in batches of 300 that carry on from where the last stopped | On demand | One tap in Settings, then it runs batch after batch | Same as push; model cost per email that passes the pre-filter |
| By hand | Built | One booking at a time from the trip page form | Any | Immediate | Typing | Nothing |
| TripIt JSON export | Built | Every trip and reservation, already structured | Whole account history (a real export spanned 20 years) | One-off snapshot | Email TripIt customer service and wait for the file; no self-service export | A file upload in Settings and a mapping of TripIt's object shapes |
| TripIt calendar feed (`.ics` URL) | Built | Every reservation as a calendar event, text only | Last 90 days plus the future | Refreshed on each poll (daily) | Copy the feed URL from TripIt settings; official and self-service | The `.ics` importer plus a daily poller |
| TripIt per-trip export (`.ics` file) | Built | One trip's reservations as events | Any single trip | One-off | Website only, one trip at a time, "Export trip to calendar" | The `.ics` importer |
| Any `.ics` file or feed | Built | Calendar events | Whatever the calendar holds | One-off (file) or polled (URL) | Export or subscription URL from any calendar app | The `.ics` importer |
| Google Calendar | Built | Events from chosen calendars | Unlimited | Read when chosen, then daily | One OAuth consent, calendar picker | The `calendar.readonly` scope on the consent screen (a sensitive scope: verification for public use) |
| Forward-to-import address | Planned | Emails the user forwards | Anything the user still has | As forwarded | Forward a confirmation to an address | Inbound mail handling (a mail provider's inbound webhook or a dedicated mailbox) and sender verification |

## What each source gives per booking

Our segment fields against what each source carries. "Model" means the text is
run through extraction, so the field is as good as the email or event text; "Yes"
means the source has it as data.

| Field | Gmail (push, backfill, forward) | TripIt JSON | TripIt feed / `.ics` | Google Calendar | By hand |
|---|---|---|---|---|---|
| Type (flight, train, stay, …) | Model | Implied by the object's fields: `Segment[]` with airline codes is air, `train_number` is rail, `room_type` lodging, `car_type` car, `cuisine` restaurant, `DateTime` plus `detail_type_code` activity | Model, from the summary | Model | Chosen |
| Title | Model | `display_name` | `SUMMARY` | `summary` | Typed |
| Provider | Model (plus the sender domain) | `supplier_name`, `booking_site_name` | Model | Model | Typed |
| Confirmation number | Model | Absent on trip objects; present only on `UnfiledItems` | Usually in `DESCRIPTION`, via the model | Usually in the description, via the model | Typed |
| Start and end with the local offset | Model infers the offset from the place | `StartDateTime`/`EndDateTime`: `date`, `time`, IANA `timezone`, `utc_offset` | `DTSTART`/`DTEND` with `TZID` or UTC | `start`/`end` with `timeZone` | Date, time and zone picker |
| Origin and destination | Model; a missing country is filled from the airport code or by geocoding | Per leg: airport or station code, name, city, country, latitude and longitude, terminal, gate; a missing country from the address line, the airport code or geocoding | `LOCATION` plus the summary, via the model, then geocoding | `location`, via the model, then geocoding | Name, code and country |
| Legs | Model, one segment per leg | `Segment[]`, one per leg, with flight number, aircraft, seats, duration, distance | One event per leg (TripIt) or per booking (others) | One event each | One per booking |
| Notes | Model | `notes`, `restrictions`, `text` | `DESCRIPTION` | `description` | Typed |
| Travelers and guests | No | `Traveler[]`, `Guest[]`, `Driver`, `ReservationHolder` | Sometimes in the description | Attendees | No |
| Trip grouping | By dates, two-day gap | TripIt's own trips: `TripData` with name, start and end | By dates | By dates | Chosen |
| Idempotency key | Gmail message id | None in the file: derived from trip name, dates and leg details | `UID` | Event id | Segment id |
| Extra data | | `LoyaltyPrograms` (balances, status), `TravelerProfile` (documents): seeds for the loyalty and passport features | | | |

## Notes per source

- **Gmail** is the only source that keeps itself current without the user doing
  anything, and the only one whose cost scales with volume: an embedding per
  candidate and a model call per email that passes the pre-filter. The backfill is
  the cheapest route to TripIt history for anyone whose confirmations went through
  Gmail, since TripIt only ever parsed those same emails.
- **TripIt JSON** is the richest structured source and the hardest to obtain: there
  is no export button, the file comes from customer service on request. Reservation
  kinds are implied by fields, not declared: flights, trains, stays, cars,
  restaurants, activities, transfers and ferries (`TransportObject`, one booking per
  leg) and cruises (one sailing per pair of port calls, as a ferry). Run on a real
  20-year export, the mapper imported some 760 bookings in 146 of 147 trips; about a
  fifth of the file's 700 objects were reservations TripIt had stripped to a name
  (an empty leg, no dates, all of its unfiled items among them), which are listed as
  not imported under that reason rather than guessed at. A handful of activities
  carried a time with no zone; they keep the time as written at `+00:00` with a
  note, since the app shows times as written. Addresses are one line with no
  country field, so the country is read off the line's end when it names one.
  Trip objects carry no confirmation numbers, so deduplicating against Gmail imports
  goes by type, time and route (`sameBooking`). `UnfiledItems` go into a holding
  trip. `TripData` grouping is kept rather than re-derived from dates, except that a
  TripIt trip overlapping one from another source joins it. The export's profile is a
  list of templates (`TravelDocumentPassport`, `TravelAccountAir`, `TravelAccountCar`,
  `UserProfilePublic`): passports become documents, the accounts join
  `LoyaltyPrograms` (whose transaction logs are left out), and the traveler's own
  details make one entry; every value is kept under a label from its path, and the
  owner can share that profile with people they trust.
- **TripIt feed** is official and self-service but a rolling window: 90 days back
  plus future trips. Good for keeping a TripIt account in sync during a migration,
  not for history.
- **`.ics`** in general carries text, not structure, so it runs through the same
  extraction as an email, with the summary, location and description as the body;
  the model call costs the same, the pre-filter has less to go on (the title only:
  booking words, flight and train numbers, airport routes; a TripIt calendar skips
  it). Recurring (`RRULE`) and cancelled (`STATUS:CANCELLED`) events are skipped;
  a cancellation of an event already imported removes its booking unless the
  user edited it or another source was matched to it, and an event whose text
  changes (a new time, say) is read again and replaces its booking on the same
  terms.
- **Google Calendar** is a second consent, apart from Gmail's, and brings every
  calendar's noise with it, so the user picks calendars (none at first) and the
  pre-filter still applies. Events Gmail made from emails (`fromGmail`) are
  skipped when Gmail is connected to the same account, since the email itself
  is imported.
  Events are keyed by their iCalendar UID, so a TripIt calendar subscribed in
  Google and also added as a feed is read once.
- **Forward-to-import** needs inbound mail: a provider webhook (a new paid
  dependency at volume) or a mailbox the parser polls, plus proof that the forwarder
  owns the Travelmo account (a per-user address or a verified sender). It is the
  only path for people without Gmail.

## Order of work

Deploy and run on real mail first (`TODO.md`). The generic importer, the
TripIt JSON upload, `.ics` files and feeds, the uncapped backfill and Google
Calendar are built; forward-to-import comes as real users ask for it.
