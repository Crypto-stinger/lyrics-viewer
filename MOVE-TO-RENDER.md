# Moving Lyra from Replit to Render

The aim is to run lyricviewer.com on accounts you own (Render, Clerk, a domain registrar), so it no longer depends on a Replit subscription. Do it in this order and the live site never goes down: Replit keeps serving it until the very last step.

**Cost on Render:** about **$7/month** for the app (Starter) plus about **$6/month** for the database (Basic 256 MB). That's roughly $13/month, plus about $10–12/year for the domain once it's moved.

---

## What runs where

| Job | On Replit today | After the move |
|---|---|---|
| Website + API | Replit deployment | One Render web service (`lyra`) |
| Database (setlists, notes, favourites) | Replit Postgres | Render Postgres (`lyra-db`) |
| Sign-in (Google / email) | Clerk, set up by Replit | **Your own** Clerk account (free up to 10,000 users) |
| Domain lyricviewer.com | Bought through Replit | Transferred to Cloudflare or Namecheap |

The code supports both. The repo's `render.yaml` describes the Render setup, and nothing changes for Replit, which can keep running until you switch.

---

## Step 1 — Ask Replit to release the domain (start today)

Domains bought through Replit can only be moved out via **Replit Support**, and only **60 days after purchase**. Their support can be slow, so ask now:

> "Please unlock lyricviewer.com and send me the transfer authorisation (EPP) code so I can transfer it to another registrar."

Keep your Replit plan until the transfer is complete.

## Step 2 — Create your own Clerk account (sign-in)

1. Go to **dashboard.clerk.com** and sign up.
2. **Create application** → name it **Lyra** → turn on **Email** and **Google** → Create.
3. Go to **API keys** and keep that page open. You'll need the **Publishable key** (`pk_test_…`) and the **Secret key** (`sk_test_…`).

These are *development* keys. They work on any web address, so you can test on Render before the domain moves.

## Step 3 — Create the Render service

1. Go to **render.com** and **sign up with GitHub** (Crypto-stinger).
2. **New → Blueprint** → choose the **lyrics-viewer** repo. Render reads `render.yaml` and offers to create **lyra** (web service) and **lyra-db** (database), both in Singapore.
3. Render asks for the secret values:

| Name | Value |
|---|---|
| `CLERK_PUBLISHABLE_KEY` | `pk_test_…` from Clerk |
| `VITE_CLERK_PUBLISHABLE_KEY` | the **same** `pk_test_…` value |
| `CLERK_SECRET_KEY` | `sk_test_…` from Clerk |
| `GENIUS_ACCESS_TOKEN` | Copy from Replit → Secrets |
| `ACRCLOUD_HOST`, `ACRCLOUD_ACCESS_KEY`, `ACRCLOUD_ACCESS_SECRET` | Copy from Replit → Secrets (optional; leave blank to hide ACR Sync) |

4. Click **Apply**. The first build takes about 5–10 minutes. The database table is created automatically on first start.

## Step 4 — Test on the temporary address

Open the address Render shows (e.g. `https://lyra-xxxx.onrender.com`) and check:

- **Search and Live Cover ID:** the typed line `you can check out anytime you like` finds Hotel California.
- **Signed out:** Setlists says "Your setlists are private" and asks you to sign in.
- **Sign in with Google:** you come back to the home page signed in, with no "page not found".
- **Setlists:** create a setlist, sign out, and it disappears. Sign back in and it's there.

Clerk shows a small "Development mode" label while you're on test keys. That's expected.

## Step 5 — Switch sign-in to production

1. In Clerk, use the instance switcher at the top to create a **Production** instance, and enter the domain **lyricviewer.com**.
2. Go to **Domains → Frontend API → Set proxy configuration** and enter:
   `https://lyricviewer.com/api/__clerk`
   Lyra's server already includes this proxy, so you don't need extra DNS records for Clerk.
3. Set up **Google for production**. Clerk's shared Google login only works in development, so:
   - In Clerk, go to **SSO connections → Google → Use custom credentials**. It shows an **Authorized redirect URI**.
   - In **console.cloud.google.com**, go to APIs & Services → Credentials → Create credentials → OAuth client ID → Web application. Paste that redirect URI and create it.
   - Copy the Google **Client ID** and **Client secret** back into Clerk.
4. In Render, go to **lyra → Environment** and replace the three Clerk values with the production `pk_live_…` / `sk_live_…` keys (the `VITE_` one too).
5. Click **Manual Deploy → Clear build cache & deploy**. The web app has the key built in, so it must be rebuilt.

> Production sign-in only works on **lyricviewer.com** itself, not on the onrender.com address. That's normal. Test it after Step 6.

## Step 6 — Point lyricviewer.com at Render

1. In Render, go to **lyra → Settings → Custom Domains** and add **lyricviewer.com** and **www.lyricviewer.com**. Render shows the DNS records it needs, usually an **A** record for `lyricviewer.com` and a **CNAME** for `www`.
2. Add those records where the domain is managed:
   - **Before the transfer:** Replit → Domains tool → DNS Records. First unlink the domain from the Replit deployment.
   - **After the transfer:** at your new registrar.
3. Wait for Render to show **Verified**, which takes minutes to a few hours. Render issues the HTTPS certificate automatically.
4. Visitors to `www.lyricviewer.com` are sent to `lyricviewer.com` automatically. Sign-in is tied to the bare domain, which is why www was causing trouble.

## Step 7 — Bring across existing saved setlists

Replit doesn't give you a dashboard to export accounts from its Clerk, so each person signs up once on the new site (same Google account is fine). Their saved data can then be copied across:

1. **In Replit → Shell:**
   ```
   pg_dump --data-only --table=user_data "$DATABASE_URL" > user_data.sql
   ```
   Download `user_data.sql`.
2. **Load it into Render:** in **lyra-db → Connect**, copy the **External Database URL**, then on any computer with `psql`:
   ```
   psql "<External Database URL>" < user_data.sql
   ```
3. **Match old account IDs to new ones.** The old ID is in Replit's Auth pane (Users) and the new one is in Clerk → Users (both look like `user_…`). For each person:
   ```
   UPDATE user_data SET user_id = '<new id>' WHERE user_id = '<old id>';
   ```

If it's only your own account, Claude or the Replit agent can do this with you in a few minutes.

## Step 8 — Switch off Replit

Only after the site has run on Render at lyricviewer.com for about a week, the domain transfer is complete, and your data is confirmed:

1. Stop the Replit deployment.
2. Download a final copy of the Replit project for safekeeping.
3. Cancel the Replit plan.

---

### If something goes wrong
- **Render build fails:** open the build log in Render and send it to Claude.
- **Site down after the DNS change:** put the old DNS records back. Replit is still running until Step 8.
- **Sign-in fails on lyricviewer.com:** check the proxy URL in Clerk (Step 5.2), and that the `pk_live` key was rebuilt in (Step 5.5).
