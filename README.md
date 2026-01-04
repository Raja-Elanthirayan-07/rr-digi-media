# RR Digi Media — Auth-enabled Setup

This adds a simple Node.js/Express server with SQLite for login and signup, while serving your existing static site.

## Prerequisites
- Node.js 18+
- PowerShell on Windows

## Install & Run

```powershell
# In the workspace folder
npm install
npm run start
# Open http://localhost:3000/index.html
```

## API Endpoints
- POST `/api/auth/signup` { email, password, name }
- POST `/api/auth/login` { email, password } (legacy)
- POST `/api/auth/check-user` { email, phone }
- POST `/api/auth/request-otp` { email }
- POST `/api/auth/verify-otp` { email, code }
- POST `/api/auth/logout`
- GET `/api/auth/me`

## Notes
- Passwords are hashed with bcrypt.
- Sessions are stored in memory by default (sufficient for dev/testing).
- Data is saved to `server/data.db` (SQLite) by default. You can override the DB location with `DB_PATH`.

## Environment variables
Create a `.env` in the workspace root (or set system env vars):
- `PORT` (optional) – defaults to `3000`
- `NODE_ENV` (optional) – set to `production` in deployments
- `SESSION_SECRET` (recommended) – used to sign sessions
- `ADMIN_EMAIL` (required for admin panel) – only this email can access `/admin.html`
- `BUSINESS_EMAIL` (optional) – recipient for new order notifications
- `DB_PATH` (optional) – absolute or relative path to the SQLite DB file (recommended for persistent disks)

Uploads:
- `UPLOAD_DIR` (optional) – where uploaded files are stored (recommended for persistent disks)

Payments (Razorpay):
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`

### Production requirements
- When `NODE_ENV=production`, the server requires:
	- `SESSION_SECRET` length >= 32
	- `ADMIN_EMAIL` set

## Backups
Run a DB backup to `backups/`:

```powershell
npm run backup
```

### Admin login (OTP only)
- The admin account is determined by `ADMIN_EMAIL`.
- Password login is disabled for the admin email; use `/api/auth/request-otp` + `/api/auth/verify-otp` (the `login.html` page handles this).

## OTP delivery (Email only)
- Email OTP uses the same SMTP settings as order notifications:
	- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, optional `SMTP_FROM`

### Dev testing
- When `NODE_ENV` is not `production`, `/api/auth/signup` returns `{ devOtp }` so you can test locally without SMTP.

## Frontend wiring
Update `index.html` to use these endpoints for login/signup and display the logged-in state.
