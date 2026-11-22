# Deploy on the Hostinger KVM 8 VPS

Target: **Hostinger KVM 8** (8 vCPU · 32 GB RAM · 400 GB NVMe), **Ubuntu 24.04** template. Time: about 30 minutes, most of it the first build and model downloads.

## 0. Before you start

1. **Buy the VPS** and pick the **Ubuntu 24.04 (plain OS)** template. Set a root password or SSH key.
2. **Point a domain at it.** In your DNS add an `A` record, e.g. `agents.yourcompany.com → <VPS IP>`. Caddy uses this to get the HTTPS certificate automatically.
3. Have ready: the domain, an admin email, and an admin password (10+ characters).

## 1. Install (one command)

```bash
ssh root@<VPS IP>
git clone https://github.com/Rohit94r/Layerflow-agents.git /opt/layerflow
cd /opt/layerflow
sudo bash scripts/vps/install.sh
```

The script asks for the domain and admin login once, then:

| Step | What happens |
| --- | --- |
| Host | Firewall (22/80/443), 8 GB swap, automatic security updates |
| Docker | Installs Docker Engine + Compose |
| `.env` | Created from `.env.example` with generated secrets (`APP_SECRET_KEY`, `POSTGRES_PASSWORD`, `TOKEN_ENCRYPTION_KEY`), mode 600 |
| Stack | Builds and starts postgres, api, worker, web, ollama, caddy |
| Models | Pulls and warms `qwen2.5:3b-instruct`, `qwen2.5:7b-instruct`, `nomic-embed-text` (~7 GB download) |
| Demo | Optionally creates the MarketPulse and CollegeCompass demo workspaces |
| Boot | systemd: starts on boot; daily database backup at 02:00 |

Open `https://agents.yourcompany.com` and sign in with the admin account. That account is the **platform admin** and can open every client workspace.

## 2. Verify

```bash
cd /opt/layerflow
docker compose -f docker-compose.yml ps                 # all services "running (healthy)"
curl -s https://agents.yourcompany.com/api/v1/health    # database ok, model ok, worker ok
docker compose -f docker-compose.yml exec ollama ollama ps   # models loaded
```

In the dashboard:

1. **Clients → New client** → choose starter agents from the catalogue (e.g. Smart Web Scraper, Content Writer, Auto Publisher).
2. **Agents**: open each agent and set the real sources, persona and formats. Use **Test** on each one.
3. **Connections**: add the client's site (Next.js / WordPress / webhook) and press **Test**.
4. **Pipelines** → **Run now**. Watch it step by step in **Runs**.
5. **Content**: approve, then it publishes.

## 3. Day-2 operations

| Task | Command |
| --- | --- |
| Update to latest code | `bash scripts/vps/update.sh` (backup → pull → rebuild → migrate → health check) |
| Logs | `docker compose -f docker-compose.yml logs -f worker` (or `api`, `web`, `ollama`, `caddy`) |
| Restart everything | `sudo systemctl restart layerflow` |
| Change models | edit `MODEL_*` in `.env` → `bash scripts/vps/pull-models.sh` → `docker compose -f docker-compose.yml up -d` |
| Backup now | `bash scripts/backup.sh` (files in the `backups` volume; set `BACKUP_RCLONE_REMOTE` for offsite) |
| Test a restore | `bash scripts/restore_check.sh` |
| Disk usage | `docker system df` and `df -h` |

Full runbook (alerts, troubleshooting, restore): [`docs/ops/runbook.md`](../ops/runbook.md).

## 4. Security checklist

- [ ] Log in with an SSH key, then set `PasswordAuthentication no` in `/etc/ssh/sshd_config` and `systemctl restart ssh`.
- [ ] Never commit `.env`. It holds every secret. Keep a copy in your password manager.
- [ ] `APP_ENV=production` (the default). This forbids `DISABLE_AUTH` and hides the API docs.
- [ ] Give each client website its own API key with only the scopes it needs. The browser widget key gets `assistant:chat` only.
- [ ] Turn on Hostinger's weekly VPS snapshots as a second layer of backup.

## 5. Upgrading later

- **More RAM/CPU** (Hostinger plan upgrade): nothing to change. Optionally raise `OLLAMA_MEM_LIMIT` and switch the writer to `qwen2.5:14b-instruct`.
- **GPU model host:** run Ollama on the GPU machine, connect it privately (Tailscale), then in `.env` remove `local-model` from `COMPOSE_PROFILES` and set `OLLAMA_BASE_URL=http://<tailscale-ip>:11434`. Then run `docker compose -f docker-compose.yml up -d`.
- **Separate database server:** point `DATABASE_URL` at it; the app is stateless apart from Postgres and the `artifacts` volume.
