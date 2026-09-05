# repair-log

## Authentication

The API uses JWT bearer tokens and bcrypt password hashes. Set a long random
`JWT_SECRET` in `server/.env` before starting the server.

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
