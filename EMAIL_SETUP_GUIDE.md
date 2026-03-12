# Email Sending Setup Guide (Gmail SMTP + Backup Gmail)

## What This Project Uses
This admin project sends customer emails using **Gmail SMTP (Nodemailer)**.

- **Primary Gmail sender**: `GMAIL_USER` / `GMAIL_PASS`
- **Backup Gmail sender** (automatic failover): `GMAIL_BACKUP_USER` / `GMAIL_BACKUP_PASS`

If the primary sender fails (including common quota/rate-limit errors), the system automatically retries with the backup sender.

## Important Limitations (Gmail)
Gmail accounts have daily sending limits (and anti-abuse checks). If you send to many users at once, you can hit quota limits.

This code supports **failover**, but it cannot guarantee unlimited email volume with personal Gmail.

## Step 1: Create Gmail App Password(s)
For each sending Gmail account:

1. Turn on **2‑Step Verification** for the Gmail account.
2. Create a **Google App Password** for “Mail”.
3. Use the app password in `GMAIL_PASS` / `GMAIL_BACKUP_PASS`.

## Step 2: Configure `.env.local` (Local Dev)
Add (or update) these variables in `.env.local`:

```env
# Required (Supabase admin access)
SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Your deployed admin URL (used in some server → server calls)
NEXT_PUBLIC_BASE_URL=https://your-admin.vercel.app

# (Optional) your user-facing website base URL (used for some proxies)
NEXT_PUBLIC_USER_WEBSITE_URL=https://your-website.vercel.app

# Gmail SMTP (Primary sender)
GMAIL_USER=primary.sender@gmail.com
GMAIL_PASS=your_app_password
GMAIL_FROM=primary.sender@gmail.com

# Gmail SMTP (Backup sender)
GMAIL_BACKUP_USER=backup.sender@gmail.com
GMAIL_BACKUP_PASS=your_app_password
GMAIL_BACKUP_FROM=backup.sender@gmail.com
```

## Step 3: Configure Vercel (Production)
`.env.local` is **not** used by Vercel.

In your Vercel project:

1. Go to **Settings → Environment Variables**
2. Add the same variables listed above
3. Redeploy

## Step 4: Test SMTP
From the admin project folder:

```bash
node test-email.js your-email@example.com
```

To force-test the backup sender:

```bash
node test-email.js your-email@example.com --backup
```

## Security Notes
- Never commit real secrets (service role keys, app passwords) to GitHub.
- Ensure `.env.local` is ignored by git.
