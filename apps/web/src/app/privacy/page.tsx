import Link from "next/link";

export const metadata = { title: "Privacy" };

// The privacy policy the Play listing and Google's OAuth consent screen link
// to. Readable without signing in. Keep it in step with what the code does
// (SPEC.md "Data model", "Import pipeline"); a change in what is collected or
// who receives it changes this page in the same pull request, and
// docs/PRIVACY.md (the same text for GitHub Pages and repository readers)
// with it: e2e/privacy.spec.ts fails when the two say different things.
const CONTACT = "play@mikelward.com";
const UPDATED = "23 November 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="mt-2 space-y-3 text-zinc-700 dark:text-zinc-300">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <article className="max-w-prose leading-relaxed">
      <h1 className="text-2xl font-semibold">Privacy</h1>
      <p className="mt-2 text-sm text-muted">Last updated {UPDATED}</p>
      <p className="mt-4 text-zinc-700 dark:text-zinc-300">
        Travelmo keeps your trips in one place, on the web and in the Android app. This page says what it stores, why,
        who else handles it, and how to remove it. Travelmo has no ads and never sells your data.
      </p>

      <Section title="What Travelmo stores">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Your account:</strong> the name, email address and photo of the Google account you sign in with,
            and any other email addresses you add in Settings.
          </li>
          <li>
            <strong>Your access:</strong> whether you asked to use Travelmo, who invited you or which admin approved or
            declined you, or that you used it before approvals, and when.
          </li>
          <li>
            <strong>Your trips and bookings:</strong> titles, dates, times, places, providers, confirmation numbers, notes,
            ratings, and where each booking came from.
          </li>
          <li>
            <strong>Your travel profile,</strong> if you import a TripIt export: travelers, documents such as passports and
            visas with their numbers and expiry dates, and loyalty programs.
          </li>
          <li>
            <strong>Connections you turn on:</strong> access to read your Gmail accounts, Fastmail or Google Calendar,
            calendar feed addresses,
            your forwarding address, your calendar export link, and the devices and browsers you asked to notify.
          </li>
          <li>
            <strong>A record of each email or calendar event it looked at:</strong> the sender, the subject, and whether it
            became a booking, so the same message is never read twice and you can review what was skipped.
          </li>
        </ul>
      </Section>

      <Section title="Gmail and Google Calendar">
        <p>
          When you connect Gmail, Travelmo gets read-only access to that mailbox; you can connect up to five. It
          downloads each new email to check
          whether it is a booking confirmation, judging first by the sender and subject. Emails that look like bookings
          go to Google&apos;s Gemini API, which reads them and returns any booking in them; for some, Gemini first
          compares the subject with earlier ones. Of emails that aren&apos;t bookings, Travelmo keeps the sender, the
          subject and why it skipped them, so you can review what it passed over, but not their text.
          Travelmo never sends, changes or deletes email. Google Calendar access is read-only too, and only the
          calendars you choose are read.
        </p>
        <p>
          Travelmo&apos;s use and transfer of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" className="underline">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Email content is used only to find your bookings and add them to your
          trips. It is not used for advertising, not sold, not read by people except to fix a problem you report or where
          the law requires it, and not used to train AI models.
        </p>
        <p>
          You can disconnect each Gmail account, or Google Calendar, in Settings at any time; Travelmo then revokes its
          access.
        </p>
      </Section>

      <Section title="Fastmail">
        <p>
          When you connect Fastmail, you give Travelmo a read-only API token you made in Fastmail&apos;s settings, and
          Travelmo keeps it on its servers. It uses the token only to read new email every few minutes, and past email
          when you import it, handling each email as it does with Gmail: only ones that look like bookings go to
          Gemini, and it never sends, changes or deletes email.
        </p>
        <p>
          Disconnecting Fastmail in Settings deletes the token from Travelmo. Travelmo can&apos;t revoke a Fastmail
          token, so delete it in Fastmail too.
        </p>
      </Section>

      <Section title="Who else handles your data">
        <p>Travelmo uses these services to run, and they handle data only to provide them:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Google Cloud and Firebase</strong> host the app and store your data, and handle sign-in and phone
            notifications.
          </li>
          <li>
            <strong>Google&apos;s Gemini API</strong> reads the text of an email, calendar event or file that looks like a
            booking and returns the booking&apos;s details.
          </li>
          <li>
            <strong>Google Maps Platform</strong> looks up the places in your bookings by name, and suggests addresses as
            you type one.
          </li>
          <li>
            <strong>FlightAware</strong> is asked about a flight&apos;s number, date and departure airport, never who is
            on it, to give its gates and baggage carousel near departure and arrival.
          </li>
          <li>
            <strong>Cloudflare</strong> receives emails you forward to your Travelmo address and passes them on.
          </li>
          <li>
            <strong>An email delivery service</strong> sends the reminders you ask for by email, and your browser&apos;s
            push service delivers the notifications you turn on in a browser.
          </li>
        </ul>
        <p>
          People you share a trip with see its bookings. People you share your travel profile with see all of it, documents
          included. Sharing with an email address also lets it use Travelmo.
        </p>
        <p>
          Travelmo&apos;s admins see the email address of everyone who asks to use it, and are sent it by email and
          notification when someone asks.
        </p>
      </Section>

      <Section title="On your phone">
        <p>
          The Android app keeps a debug log on the phone to help fix bugs. It records what the app did, never your bookings
          or addresses, and leaves the phone only if you share it from Settings.
        </p>
      </Section>

      <Section title="Analytics and telemetry (planned)">
        <p>
          Travelmo doesn&apos;t collect analytics yet. The plan is to count, on its own servers and across all its users,
          which travel companies and email services bookings come from and how often reading them fails, to improve how
          Travelmo reads them. The counts will name companies, never people: no email addresses, subjects or email text,
          and a company with too few bookings to keep its users anonymous will be left out. Nothing will be stored on
          your device for this and nothing will go to an analytics service. If the Android app later sends crash reports,
          it will ask first, with a switch in Settings that is off until you turn it on. This page will change, with a new
          date, before any of this starts or if the plan changes.
        </p>
      </Section>

      <Section title="Keeping and deleting your data">
        <p>
          Your data stays until you delete it. Deleting a trip or booking removes it; disconnecting Gmail or Google Calendar
          removes Travelmo&apos;s access, and disconnecting Fastmail deletes its API token. Deleting your account in Settings removes your trips, bookings, travel profile,
          connections and access record, and takes you off trips others shared with you; bookings you added to someone else&apos;s trip stay
          with that trip. Service logs are kept for 30 days.
        </p>
        <p>
          To ask about your data or have it deleted without signing in, email{" "}
          <a href={`mailto:${CONTACT}`} className="underline">
            {CONTACT}
          </a>
          .
        </p>
      </Section>

      <Section title="Children">
        <p>Travelmo is not meant for children under 13 and does not knowingly collect their data.</p>
      </Section>

      <Section title="Changes">
        <p>
          If this policy changes, this page changes with it, along with the date above.
        </p>
      </Section>

      <p className="mt-10">
        <Link href="/" className="underline">
          Back to Travelmo
        </Link>
      </p>
    </article>
  );
}
