# FACT Ordering System

A self-hosted ordering system for **Fourth Avenue Coffee & Tea**.

- Customers browse the menu, pick variants (size/milk/etc.), choose a pickup
  date + time slot, and order — no account needed, just name + phone.
- You control everything from `/admin.html`: menu items, pickup slots (with
  capacity limits), and order status.
- Payment is either "pay on pickup" or a PayNow QR code generated per order
  (you confirm payment manually against your banking app).
- Customers get an email confirmation, and can check their order status
  later using their order reference + phone number.

Runs as two small Docker containers: the app itself, and Caddy (which gets
you free, auto-renewing HTTPS for your domain).

---

## 1. What you need

- A Raspberry Pi (4 or 5 recommended) running **64-bit** Raspberry Pi OS.
  64-bit matters — some dependencies don't have prebuilt packages for 32-bit
  ARM and would need to compile from source, which is slower and more
  failure-prone.
- A domain name you already own, pointed at this Pi (see step 4).
- A Gmail account for sending confirmation emails, with an **App Password**
  (not your normal password) — see step 3.
- Your PayNow-registered mobile number.
- Router access to set up port forwarding.

## 2. Install Docker on the Pi

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
# log out and back in for the group change to take effect
```

Check it worked:

```bash
docker --version
docker compose version
```

## 3. Get the project onto the Pi and configure it

Copy this whole folder onto the Pi (USB drive, `scp`, or `git clone` if you
put it in a repo), then:

```bash
cd fact-system
cp .env.example .env
nano .env
```

Fill in `.env`:

- **SESSION_SECRET** — generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
  (If you don't have Node installed on the Pi directly, any long random
  string works — even mashing the keyboard for 40+ characters is fine.)
- **GMAIL_USER** — your Gmail address.
- **GMAIL_APP_PASSWORD** — go to https://myaccount.google.com/apppasswords
  (requires 2-Step Verification turned on for your Google account first),
  create an app password for "Mail", and paste the 16-character code here.
- **PAYNOW_PROXY_TYPE** — leave as `mobile`.
- **PAYNOW_PROXY_VALUE** — your PayNow-registered mobile number, in the
  format `+6591234567`.
- **PAYNOW_MERCHANT_NAME** — keep this short (max 25 characters) — `FACT`
  is already set as the default.

## 4. Point your domain at your home network

1. Find your home's current public IP: visit https://whatismyip.com on any
   device at home.
2. In your domain's DNS settings, create an **A record** for the subdomain
   you want (e.g. `order.yourdomain.com`) pointing to that IP address.
3. **Important caveat:** most home internet plans don't give you a fixed
   IP — it can change occasionally (e.g. after a power outage). If your
   site stops loading after one, check whether your IP changed and update
   the A record. Many routers have a built-in "Dynamic DNS" (DDNS) feature
   that can keep this updated automatically — worth turning on if your
   router supports it, paired with a DDNS hostname that you then `CNAME`
   your subdomain to.
4. On your **router**, forward external ports `80` and `443` to your Pi's
   local IP address, same ports (80→80, 443→443 on the Pi). This is usually
   under "Port Forwarding" or "Virtual Server" in your router's settings —
   the exact menu varies by brand.
5. Edit `Caddyfile` and replace `yourdomain.com` with your real subdomain.

## 5. Build and start it

```bash
docker compose up -d --build
```

The first time Caddy starts, it will automatically request a free HTTPS
certificate from Let's Encrypt for your domain — this requires ports 80/443
to already be reachable from the internet (step 4), so do that first.

Check logs if anything looks wrong:

```bash
docker compose logs -f
```

## 6. Create your admin login

```bash
docker compose exec app node scripts/create-admin.js yourusername "a-strong-password"
```

Only one admin account is supported. Running this again replaces it (handy
if you forget your password).

## 7. Set up your menu and pickup slots

1. Visit `https://yourdomain.com/admin.html` and log in.
2. **Menu tab** — add each drink, its category (e.g. `Coffee` / `Tea`), base
   price, and any variant groups (e.g. a "Size" group with Small/Medium/Large
   options, each with a price adjustment).
3. **Pickup slots tab** — manually add the dates/times you're open for
   pickup, with optional caps on number of orders and/or total items per
   slot. Customers can only book slots you've created here — nothing is
   auto-generated.

Your customer-facing site is at `https://yourdomain.com/`.

## 8. Before you rely on PayNow QR for real money

The QR code is generated from the published PayNow/EMVCo specification, but
I can't test-scan it myself in this environment. **Before taking real
orders**, place one test order with a tiny amount (e.g. $0.01) and scan the
generated QR with your own banking app to confirm the amount and payee look
right. If something's off, double-check `PAYNOW_PROXY_TYPE` and
`PAYNOW_PROXY_VALUE` in `.env`.

## Alternative: deploying through the Portainer UI

If you manage this server with Portainer and want to do as much as possible
through its web interface rather than the command line, here's the path:

### a. Get the source files onto the server (one unavoidable file-copy step)

Portainer can build and run this app entirely through its UI once the files
exist on disk — it just can't fetch them from your computer itself without
git. So, once, copy the project there:

```bash
scp -r fact-system your-username@SERVER_IP:~/fact-system
```

(WinSCP/FileZilla work too if you'd rather drag-and-drop than use a terminal.)
Pick whatever path you like — these instructions assume `~/fact-system` on
the server (i.e. `/home/your-username/fact-system`).

You do **not** need to create `.env` or edit `Caddyfile` for this path —
secrets and the domain are set as environment variables in Portainer's UI
in step c below instead.

### b. In Portainer: Stacks → Add stack

- Name it `fact-system`.
- Build method: **Web editor**.
- Paste this (replace `/home/your-username/fact-system` with the real
  absolute path you copied the files to):

```yaml
services:
  app:
    build:
      context: /home/your-username/fact-system
      dockerfile: Dockerfile
    container_name: fact-app
    restart: unless-stopped
    environment:
      NODE_ENV: production
      SESSION_SECRET: ${SESSION_SECRET}
      BUSINESS_NAME: ${BUSINESS_NAME}
      GMAIL_USER: ${GMAIL_USER}
      GMAIL_APP_PASSWORD: ${GMAIL_APP_PASSWORD}
      PAYNOW_PROXY_TYPE: ${PAYNOW_PROXY_TYPE}
      PAYNOW_PROXY_VALUE: ${PAYNOW_PROXY_VALUE}
      PAYNOW_MERCHANT_NAME: ${PAYNOW_MERCHANT_NAME}
    volumes:
      - /home/your-username/fact-system/data:/app/data
    expose:
      - "3000"

  caddy:
    image: caddy:2-alpine
    container_name: fact-caddy
    restart: unless-stopped
    environment:
      DOMAIN: ${DOMAIN}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /home/your-username/fact-system/Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app

volumes:
  caddy_data:
  caddy_config:
```

Because the `build.context` is an absolute path rather than `.`, Portainer
can use it directly even though the stack definition itself only lives in
Portainer's own storage — it doesn't need the Dockerfile alongside it.

### c. Set the environment variables

Still on the Add Stack page, scroll to **Environment variables** and add
each of these (these are the same values described in step 3 of the main
instructions above):

| Name | Example value |
|---|---|
| `SESSION_SECRET` | a long random string |
| `BUSINESS_NAME` | `Fourth Avenue Coffee & Tea` |
| `GMAIL_USER` | `youraddress@gmail.com` |
| `GMAIL_APP_PASSWORD` | your 16-character Gmail app password |
| `PAYNOW_PROXY_TYPE` | `mobile` |
| `PAYNOW_PROXY_VALUE` | `+6591234567` |
| `PAYNOW_MERCHANT_NAME` | `FACT` |
| `DOMAIN` | `order.yourdomain.com` |

Make sure your DNS A record and router port forwarding (ports 80/443) are
already set up for that domain, same as described above — Caddy needs that
in place to get its HTTPS certificate.

Click **Deploy the stack**. This stack will show up with full control in
Portainer (not "limited") since you created it through Portainer itself.

### d. Create your admin account — also through the UI

Once the `fact-app` container is running: Containers → `fact-app` →
**Console** → Connect (shell: `/bin/sh` or `/bin/bash`), then run:

```bash
node scripts/create-admin.js yourusername "a-strong-password"
```

That's it — menu and slot management from here on is all in
`/admin.html`, and redeploys/log-viewing/restarts all happen from the
Portainer Stacks page.

## Alternative: deploying via Portainer + GitHub (Repository method)

This is the most "native" way to run this in Portainer: it clones the
whole repo itself (so it can use the `build: .` context as-is, no absolute
paths needed), shows up with full control (not "limited"), and can
optionally auto-redeploy whenever you push changes.

### a. Push the project to a GitHub repo

From wherever you have the `fact-system` folder (your own computer or the
server — either works):

```bash
cd fact-system
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/yourusername/fact-system.git
git push -u origin main
```

`.env` and the actual database file are already excluded by `.gitignore`,
so no secrets get pushed. Public or private both work — private is fine
for a small personal repo like this. If push asks for a password, GitHub
no longer accepts your account password for this — generate a Personal
Access Token at https://github.com/settings/tokens and use that instead.

### b. In Portainer: Stacks → Add stack

- Name it `fact-system`.
- Build method: **Repository**.
- Repository URL: `https://github.com/yourusername/fact-system.git`
- Repository reference: `main` (or your branch)
- Compose path: `docker-compose.yml` (default)
- If the repo is private, toggle **Authentication** and enter your GitHub
  username + the Personal Access Token from step a as the password.
- Optional but handy: enable **GitOps updates** so pushing to GitHub later
  automatically redeploys the stack — useful if you ever want my help
  tweaking the code further.

### c. Environment variables

Same list as the no-git method above: `SESSION_SECRET`, `BUSINESS_NAME`,
`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `PAYNOW_PROXY_TYPE`,
`PAYNOW_PROXY_VALUE`, `PAYNOW_MERCHANT_NAME`, `DOMAIN`. Add these in the
**Environment variables** section of the same Add Stack page, then click
**Deploy the stack**.

### d. Create your admin account

Same as before: Containers → `fact-app` → **Console** → connect, then:

```bash
node scripts/create-admin.js yourusername "a-strong-password"
```

### A note on backups with this method

Portainer stores the cloned repo (including your live `data/fact.db`,
since it's just an untracked file sitting in that folder) somewhere under
its own data directory on the host — not inside the repo you copied
manually. To find the exact path for backups:

```bash
docker inspect fact-app --format '{{json .Mounts}}'
```

That'll show you the real host path the `data` folder is bind-mounted
from. Back up the `fact.db` file from there periodically, same as
described below.

## Day-to-day use

- **New orders** show up under the Orders tab as `pending`. Check your
  banking app for PayNow payments, then mark them `paid`.
- When you've made the drink and it's ready, click **Notify ready** to send
  the customer a "ready for pickup" email, and **Mark fulfilled** once
  they've collected it.
- **Cancel** is available for no-shows or out-of-stock situations.

## Backing up your data

Everything (menu, slots, orders) lives in one file: `data/fact.db`. Copy it
somewhere safe periodically, e.g.:

```bash
cp data/fact.db ~/fact-backup-$(date +%F).db
```

## Updating the app later

If you make changes to the code:

```bash
docker compose up -d --build
```

Your data isn't touched — it lives in `./data`, outside the containers.

## Troubleshooting

- **Site doesn't load over HTTPS** — check `docker compose logs caddy`.
  Usually means ports 80/443 aren't actually reaching the Pi (re-check
  router port forwarding and that your DNS A record matches your current
  public IP).
- **better-sqlite3 fails to build** — make sure you're on 64-bit Raspberry
  Pi OS. You can check with `uname -m` (should say `aarch64`, not `armv7l`).
- **Emails not sending** — double-check the Gmail App Password (not your
  normal password), and that 2-Step Verification is on for that account.
