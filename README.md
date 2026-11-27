# repair-log

## Authentication

The API uses JWT bearer tokens and bcrypt password hashes. Set a long random
`JWT_SECRET` in `server/.env` before starting the server.
Signing in or out returns the user to the dashboard.

Password reset links are sent through SMTP. Configure these variables in
`server/.env` to enable the reset flow:

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
EMAIL_FROM=Repair Log <noreply@example.com>
CLIENT_URL=https://app.example.com
```

For SMTP port 465, set `SMTP_SECURE=true`; for port 587, use `false`. The
database account needs permission to create the `password_reset_tokens` table,
which the API creates automatically when the reset flow is first used. Links
expire after 30 minutes and can only be used once.

## Adding events

Sign in and select **Add Event** on the dashboard. Choose
the date and an existing venue, and optionally add a comment. The dashboard
shows the seven most recent events up to and including today, using the
browser's local date. All events remain available in the Repair Log filters
and when adding repairs. Venues must already exist in the `lookup` table
with `lk_group` set to `venue`.

The Repair Trends chart shows total and fixed repairs for all events in the
selected calendar year, including future events. The year filter lists years
with events and defaults to the current year when available, or the latest
year otherwise. Hover over a date label or point for its full date; points also show
the repair count. Event totals include all repairs, not just those in the
limited repair list.

## Client routing

The dashboard is at `/` and the repair log is at `/repairs`. Repair log
filters are retained in the URL as `event` and `section` query parameters,
so links, refresh and browser navigation preserve the selection.
The Unique ID shown in the repair log and form is the repair's `rp_uid`;
`repair_id` is the internal database key. The repair log is sorted by
Unique ID in descending order.
The repair form's **Cancel** button asks for confirmation only when there
are unsaved changes.

Administrators can use **Admin** to add, edit or delete events, users and
lookups. Events with repairs cannot be deleted. Lookup groups can be filtered,
including header records. Lookups used by an event or repair cannot be deleted,
moved to another group, or made into a header. Administrators cannot delete
their own account or remove their own administrator access. Administrator
permissions are checked against the database for protected actions.
Any signed-in user can add events and repairs; editing or deleting repairs
and importing CSV files remain administrator-only.

The web server must serve `index.html` for client routes. The supplied
`client/hostinger.htaccess` contains the rewrite rules for Apache hosting.

## Creating users

An administrator can add a user on the **Users** tab of **Admin**, setting an
initial password of at least 12 characters and no more than 72 UTF-8 bytes.
The password is stored as a bcrypt hash. Subsequent password changes use the
password reset flow.

Run the API and client separately during development:

```powershell
cd server
npm run dev

cd ../client
npm run dev
```
