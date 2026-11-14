# repair-log

## Authentication

The API uses JWT bearer tokens and bcrypt password hashes. Set a long random
`JWT_SECRET` in `server/.env` before starting the server.

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

Sign in as an administrator and select **Add Event** on the dashboard. Choose
the date and an existing venue, and optionally add a comment. The new event
appears in the dashboard and is available when adding repairs. Venues must
already exist in the `lookup` table with `lk_group` set to `venue`.

## Creating users

Create a user by generating a bcrypt hash from the server directory:

```powershell
node -e "const bcrypt=require('bcryptjs'); bcrypt.hash('your-password', 12).then(console.log)"
```

Then insert the generated hash into `logusers`:

```sql
INSERT INTO logusers (lu_email, lu_password, lu_admin)
VALUES ('user@example.com', '<bcrypt-hash>', 0);
```

Run the API and client separately during development:

```powershell
cd server
npm run dev

cd ../client
npm run dev
```
