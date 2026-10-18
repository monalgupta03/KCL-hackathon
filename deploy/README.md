# SavourIt on Vultr: one VM, two containers

Use one existing Vultr Cloud Compute VM with Ubuntu 24.04 LTS and Docker Compose.
Caddy serves the existing static frontend, terminates HTTPS and proxies `/api/*`
to FastAPI. TigerData remains the existing external PostgreSQL service. No new
managed database, Kubernetes, registry or load balancer is needed.

No server has been provisioned and no deployment has been performed by this change.
If you do not already have a VM, creating one in Vultr is a separate paid action.

## Requirements and existing application behavior

- A public hostname you control, pointing to the VM's public IPv4 address with an
  A record. Set an AAAA record only if IPv6 actually reaches this VM.
- TCP 80 and 443 reachable through both the Vultr firewall and the VM firewall.
  Permit SSH (22) from your own IP. Do not publish FastAPI port 8000 or PostgreSQL.
- Outbound DNS and HTTPS for certificates/Gemini and outbound access to the host
  and port in your existing TigerData connection string. If TigerData uses an IP
  allowlist, include the VM's public egress IP.
- The TigerData role must retain its existing table creation/ALTER permissions:
  the existing inventory endpoint runs its schema setup on inventory requests.
- The frontend's three hardcoded API URLs are in `js/api.js`, `js/add.js` and
  `js/app.js`. The web image changes those URLs to `/api` **only inside the image**.
  Checked-out JS, the localhost ports and the existing CORS settings are unchanged.
  HTTPS keeps camera access available and avoids browser mixed-content failures.
- The existing app has no account authentication. Caddy therefore requires a
  shared demo login for the site and API. This is a private hackathon deployment,
  not a multi-user account system. People with that login share the same inventory.
- Cooking/leftovers retain their current browser-local behavior. Deployment does
  not add server persistence for those features or repair Gemini model access/quota.

## 1. Prepare the VM and DNS

Point your hostname, e.g. `savourit.example.com`, at the existing Vultr VM.
In Vultr's firewall, allow TCP 80/443 publicly and 22 from your own IP.
SSH into the VM using your existing SSH account:

```sh
ssh YOUR_SSH_USER@YOUR_SERVER_IP
```

If Docker/Compose are already installed (for example, on Vultr's Docker image),
skip the installation commands. On a plain Ubuntu 24.04 VM:

```sh
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo docker compose version
```

If UFW is enabled, allow web traffic while preserving your current SSH access:

```sh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

Do not enable a new firewall until your SSH allow rule is configured.

## 2. Copy the project

From your development machine, replace the SSH destination below. This includes
uncommitted app/deployment files, but excludes credentials and local environments:

```sh
rsync -av --exclude='.git/' --exclude='.env' --exclude='.env.*' \
  --exclude='*.env' --exclude='.venv/' --exclude='__pycache__/' \
  --exclude='.agents/' --exclude='.codex/' --exclude='.aws/' \
  --exclude='*.pem' --exclude='*.key' --exclude='*.p12' --exclude='*.pfx' \
  ./ YOUR_SSH_USER@YOUR_SERVER_IP:~/savourit/
```

`backend/.env.example` may be excluded by that transfer; the next step creates a
fresh environment file on the server. Never copy credentials into the web image.

## 3. Set server-only configuration

On the VM:

```sh
cd ~/savourit
umask 077
cp deploy.env.example deploy.env
nano backend/.env
```

Enter the existing TigerData connection URL and Gemini key in `backend/.env`.
Use **single quotes** to preserve `$`, `#` and other special characters through
Compose's env-file parser; percent-encode special characters inside URL credentials.
Do not add `export` prefixes. These are placeholders, not credentials:

```dotenv
GEMINI_API_KEY='YOUR_EXISTING_GEMINI_KEY'
TIMESCALE_SERVICE_URL='postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require'
```

`TIMESCALE_SERVICE_URL` is required for inventory. `GEMINI_API_KEY` enables normal
Gemini features; an empty key retains the current meal fallback/unknown expiry
behavior and disables camera recognition. No backend `.env` file is baked into
an image: Compose injects these variables only into FastAPI.

Generate a shared demo password hash interactively (the command prompts for the
password rather than putting it in shell history):

```sh
sudo docker run --rm -it caddy:2-alpine caddy hash-password
nano deploy.env
```

Set `SITE_DOMAIN` to your real hostname without `https://` or a path, optionally
change `DEMO_USERNAME`, and replace the placeholder hash with the generated hash.
Keep the hash **single-quoted**. No Gemini or database secrets belong in `deploy.env`.

```sh
chmod 600 backend/.env deploy.env
```

Both real environment files are excluded by the existing `.gitignore` and the new
`.dockerignore`. Never paste the expanded output of `docker compose config`
without `-q`: it can contain secrets.

## 4. Validate, build and start

From `~/savourit` on the VM:

```sh
sudo docker compose --env-file deploy.env config -q
sudo docker compose --env-file deploy.env build
sudo docker compose --env-file deploy.env run --rm --no-deps web caddy validate --config /etc/caddy/Caddyfile
sudo docker compose --env-file deploy.env up -d
sudo docker compose --env-file deploy.env ps
sudo docker compose --env-file deploy.env logs --tail=50 backend web
```

Caddy requests and renews the public TLS certificate automatically. Its certificate
state is kept in named volumes across restarts. Only Caddy publishes host ports;
FastAPI runs as a non-root user on the private Compose network, without `--reload`.

## 5. Check the deployment without calling Gemini

Replace the domain below; `curl -u demo` prompts for the shared password. If you
changed the username, use it instead:

```sh
curl -I https://savourit.example.com/
curl -u demo --fail https://savourit.example.com/api/health
```

The first request should return 401. The authenticated health response should be
`{"status":"ok"}`. The health check does not access TigerData or Gemini.

Open `https://savourit.example.com/` and sign in. To verify static files and database
reads without Gemini, inspect Fridge and Add **without submitting anything**.
The existing inventory GET may perform its usual schema setup, but does not edit
inventory rows. Opening Cook, submitting a manual item without a date, or using
photo recognition can call the live Gemini API; do those only when you intend to.

## Updates and stopping

Transfer changed project files with the same rsync command, then:

```sh
sudo docker compose --env-file deploy.env up -d --build
```

To stop the app while keeping certificate state and TigerData data:

```sh
sudo docker compose --env-file deploy.env down
```

Do not add `-v` if you want to keep the TLS certificate volumes. No database
container or database volume is created by this setup.

## References and validation limits

- [Vultr Docker marketplace guide](https://docs.vultr.com/how-to-use-vultrs-docker-marketplace-application)
- [Ubuntu 24.04 Compose package](https://packages.ubuntu.com/noble/docker-compose-v2)
- [Caddy automatic HTTPS requirements](https://caddyserver.com/docs/automatic-https)
- [Caddy password authentication](https://caddyserver.com/docs/caddyfile/directives/basic_auth)
- [Compose environment interpolation and quoting](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)

Docker and Caddy were not installed in the development workspace, so container
builds and Caddy's runtime validation must be run using the commands above on the
VM. Application dependencies remain as currently declared in requirements.txt;
this change does not introduce a dependency-locking workflow.
