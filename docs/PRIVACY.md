# Privacy

Last updated 24 November 2026

Travelmo keeps your trips in one place, on the web and in the Android app. This page says what it stores, why, who else handles it, and how to remove it. Travelmo has no ads and never sells your data.

## What Travelmo stores

- **Your account:** the name, email address and photo of the Google account you sign in with, and any other email addresses you add in Settings.
- **Your access:** whether you asked to use Travelmo, who invited you or which admin approved or declined you, or that you used it before approvals, and when.
- **Your trips and bookings:** titles, dates, times, places, providers, confirmation numbers, notes, ratings, and where each booking came from.
- **Your travel profile,** if you import a TripIt export: travelers, documents such as passports and visas with their numbers and expiry dates, and loyalty programs.
- **Your reminders before trips:** what each says and when it is due, which you ticked off on each trip, and which were sent to you.
- **Connections you turn on:** access to read your Gmail accounts, Fastmail, other email accounts or Google Calendar, calendar feed addresses, your forwarding address, your calendar export link, and the devices and browsers you asked to notify.
- **A record of each email or calendar event it looked at:** the sender, the subject, and whether it became a booking, so the same message is never read twice and you can review what was skipped.

## Gmail and Google Calendar

When you connect Gmail, Travelmo gets read-only access to that mailbox; you can connect up to five. It downloads each new email to check whether it is a booking confirmation, judging first by the sender and subject. Emails that look like bookings go to Google's Gemini API, which reads them and returns any booking in them; for some, Gemini first compares the subject with earlier ones. Of emails that aren't bookings, Travelmo keeps the sender, the subject and why it skipped them, so you can review what it passed over, but not their text. Travelmo never sends, changes or deletes email. Google Calendar access is read-only too, and only the calendars you choose are read.

Travelmo's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Email content is used only to find your bookings and add them to your trips. It is not used for advertising, not sold, not read by people except to fix a problem you report or where the law requires it, and not used to train AI models.

Travelmo keeps this access encrypted on its servers. You can disconnect each Gmail account, or Google Calendar, in Settings at any time; Travelmo then revokes its access.

## Fastmail

When you connect Fastmail, you give Travelmo a read-only API token you made in Fastmail's settings, and Travelmo keeps it encrypted on its servers. It uses the token only to read new email every few minutes, and past email when you import it, handling each email as it does with Gmail: only ones that look like bookings go to Gemini, and it never sends, changes or deletes email.

Disconnecting Fastmail in Settings deletes the token from Travelmo. Travelmo can't revoke a Fastmail token, so delete it in Fastmail too.

## Other email accounts

When you connect another email account, such as iCloud or Yahoo, you give Travelmo its address and an app password you made with your email provider, and Travelmo keeps the password encrypted on its servers. It uses the password only to read your inbox: new email every few minutes, and past email when you import it, handling each email as it does with Gmail. It never sends, changes or deletes email.

Disconnecting the account in Settings deletes the app password from Travelmo. Deleting the app password with your email provider revokes it, so Travelmo can no longer read that account.

## Who else handles your data

Travelmo uses these services to run, and they handle data only to provide them:

- **Google Cloud and Firebase** host the app and store your data, and handle sign-in and phone notifications.
- **Google's Gemini API** reads the text of an email, calendar event or file that looks like a booking and returns the booking's details.
- **Google Maps Platform** looks up the places in your bookings by name, and suggests addresses as you type one.
- **FlightAware** is asked about a flight's number, date and departure airport, never who is on it, to give its gates, baggage carousel, delays, cancellation and diversion near departure and arrival.
- **Cloudflare** receives emails you forward to your Travelmo address and passes them on.
- **An email delivery service** sends the reminders you ask for by email, and your browser's push service delivers the notifications you turn on in a browser.

People you share a trip with see its bookings. People you share your travel profile with see all of it, documents included. Sharing with an email address also lets it use Travelmo.

Travelmo's admins see the email address of everyone who asks to use it, and are sent it by email and notification when someone asks.

## On your phone

The Android app keeps a debug log on the phone to help fix bugs. It records what the app did, never your bookings or addresses, and leaves the phone only if you share it from Settings.

## Analytics and telemetry (planned)

Travelmo doesn't collect analytics yet. The plan is to count, on its own servers and across all its users, which travel companies and email services bookings come from and how often reading them fails, to improve how Travelmo reads them. The counts will name companies, never people: no email addresses, subjects or email text, and a company with too few bookings to keep its users anonymous will be left out. Nothing will be stored on your device for this and nothing will go to an analytics service. If the Android app later sends crash reports, it will ask first, with a switch in Settings that is off until you turn it on. This page will change, with a new date, before any of this starts or if the plan changes.

## Keeping and deleting your data

Your data stays until you delete it. Deleting a trip or booking removes it; disconnecting Gmail or Google Calendar removes Travelmo's access, and disconnecting Fastmail or another email account deletes its token or app password. Deleting your account in Settings removes your trips, bookings, travel profile, reminders, connections and access record, and takes you off trips others shared with you; bookings you added to someone else's trip stay with that trip. Service logs are kept for 30 days.

To ask about your data or have it deleted without signing in, email [play@mikelward.com](mailto:play@mikelward.com).

## Children

Travelmo is not meant for children under 13 and does not knowingly collect their data.

## Changes

If this policy changes, this page changes with it, along with the date above.
