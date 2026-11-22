# Play Console answers

What to enter in Play Console for Travelmo (`app.travelmo`), worked out from what the
Android app does. The listing's texts and graphics live in `apps/android/play` and go up
through CI (README "Release"). Keep this page in step with `docs/PRIVACY.md`: a change in
what the app collects changes both, and the data safety form.

## Store settings

| Field | Answer |
|---|---|
| App category | Travel & Local |
| Contact email | play@mikelward.com |
| Privacy policy | https://mikelward.github.io/travelmo/PRIVACY.html |

## App content

| Section | Answer |
|---|---|
| Privacy policy | https://mikelward.github.io/travelmo/PRIVACY.html |
| Ads | No, the app has no ads. |
| App access | All or some functionality is restricted: everything is behind **Sign in with Google**. Give reviewers a test Google account (one made for this, with a sample trip or two added on the web), and say: "Sign in with Google with the account below. Trips are imported on the website from Gmail; the app shows them, and bookings can be added by hand from a trip's page." |
| Content rating | Fill in the questionnaire as below. |
| Target audience | 18 and over. The app is not designed for children, so leave "appeals to children" unticked. |
| News app | No. |
| Government app | No. |
| Financial features | None. |
| Health | None. |
| Data safety | As below. |
| Account deletion | Yes, users can delete their account in the app (Settings, Delete account). Deletion URL: https://mikelward.github.io/travelmo/PRIVACY.html#keeping-and-deleting-your-data (it gives play@mikelward.com for requests without signing in, and the website's Settings has the same Delete account). |

### Content rating questionnaire

- Category: **All other app types** (not a game, not social media).
- Violence, sexuality, language, controlled substances, gambling, horror: **No** to all.
- **Users can interact or exchange content: Yes.** A trip can be shared by email with chosen
  people, who see its bookings and can add their own. There is no chat, no public profile and
  no content visible to strangers.
- **Shares the user's current physical location: No.** Bookings name places, but the app never
  reads the phone's location.
- **Digital purchases: No.**

Expect Everyone / PEGI 3, with "Users Interact".

## Data safety

What the Android app collects and sends to Travelmo's servers (Firebase, Google Cloud).
Nothing is sold or shared with third parties: Google's services act for Travelmo, which
Play doesn't count as sharing.

**Overview answers**

- Does the app collect or share user data: **Yes**.
- Is all data encrypted in transit: **Yes** (HTTPS to Firebase and the parser).
- Can users request deletion: **Yes**, in the app and at the deletion URL above.

**Data types collected** (none shared; none processed only on the device)

| Play's category | What it is | Required? | Purposes |
|---|---|---|---|
| Personal info: Name | The Google account's name | Required | App functionality, Account management |
| Personal info: Email address | The Google account's email, and the addresses a trip or profile is shared with | Required | App functionality, Account management |
| Personal info: User IDs | The Firebase account ID | Required | App functionality, Account management |
| Personal info: Other info | Travel documents (passport and visa numbers, expiry dates) and loyalty numbers from a TripIt import | Optional | App functionality |
| App activity: Other user-generated content | Trips and bookings the user adds or edits | Optional | App functionality |
| Device or other IDs | The phone's Cloud Messaging token, for reminders as notifications | Optional | App functionality |

**Not collected:** location, financial info, health, messages, photos and videos, audio,
files, calendar, contacts, web browsing, app info and performance (no crash reports or
analytics yet), and no advertising ID.

The Android app never reads Gmail or Google Calendar. Connecting them happens on the
website, and the privacy policy covers that. If opt-in crash reports or analytics ship
(TODO.md), add "App info and performance: Crash logs / Diagnostics" (optional, App
functionality / Analytics) here and in the form.

The update dot on the ⋮ menu asks Google Play whether a newer version is out. That is a
query to Play about the app itself, carrying no user data, so it adds nothing here.

## Permissions

`INTERNET` and `POST_NOTIFICATIONS` only; neither needs a declaration.

## Testing track

Internal testing: add testers by email list, then share the opt-in link. Internal releases
reach testers within minutes, but Play may still ask for the App content declarations above
before the first one rolls out, so fill them in first.
