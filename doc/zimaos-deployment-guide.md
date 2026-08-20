# ZimaOS Deployment & Development Guide

This guide documents how to deploy, test, and manage our custom Overleaf + Clanker AI stack on a remote machine running **ZimaOS** (or CasaOS).

---

## 1. Architecture Overview

- **ShareLaTeX (Overleaf Community Edition Plus)**: Runs with custom TeX Live packages (`sharelatex/sharelatex:ext-ce-tex-packages-installed`), custom brand logo, theme-responsive CSS mask, and Pug view patches (`overleaf-sharelatex`).
- **Clanker Bot Daemon**: Runs on `node:20-alpine`, orchestrating real-time WebSocket collaborator participation, LLM queries, and an interactive web dashboard on port `5050` (`overleaf-clanker-bot`).
- **Database Backend**: MongoDB 8.0 (`overleaf-mongo`, ReplicaSet mode for document history) + Redis 7.4 (`overleaf-redis`, AOF persistence).
- **ZimaOS Web App Tile**: Native GUI management (start/stop/restart/logs and 1-click web launch at `http://<zimaos-ip>:8008`).

---

## 2. Initial Setup on Remote ZimaOS Host

SSH into your ZimaOS machine (`ssh admin@<zimaos-ip>`):

```bash
# 1. Switch to root (required for /var/lib/casaos app management)
sudo su

# 2. Navigate to AppData and clone this repository
cd /DATA/AppData
git clone <your-repo-url> overleaf-toolkit
cd overleaf-toolkit

# 3. Pull the base Community Edition Plus (CEP) image & tag it
docker pull overleafcep/sharelatex:6.2.0-ext-v5.0
docker tag overleafcep/sharelatex:6.2.0-ext-v5.0 sharelatex/sharelatex:ext-ce

# 4. Build the custom LaTeX package image (reads config/texpackages.txt)
./bin/install-tex-packages
```

---

## 3. Restore Configuration & Data

From your local machine (WSL), copy your secret `variables.env` and `data/` folder:

```bash
# In WSL: Package data and env
cd /home/kali/overleaf-toolkit
sudo tar -czvf /tmp/overleaf_backup.tar.gz data config/variables.env

# Send archive to ZimaOS
scp /tmp/overleaf_backup.tar.gz admin@<zimaos-ip>:/DATA/AppData/overleaf-toolkit/

# In ZimaOS (as root): Extract archive
cd /DATA/AppData/overleaf-toolkit
tar -xzvf overleaf_backup.tar.gz
```

---

## 4. Install & Launch via `bin/zimaos-setup`

On ZimaOS (as `root`):

```bash
cd /DATA/AppData/overleaf-toolkit
./bin/zimaos-setup
```

### What `bin/zimaos-setup` does automatically:
1. Creates the `/var/lib/casaos/apps/overleaf/` app directory.
2. Ensures all persistent data folders (`mongo`, `redis`, `overleaf`) exist with full write permissions (`chmod -R 777 data`).
3. Calls `bin/zimaos-up` to compile the Docker Compose spec, register the app with `zimaos-app-management`, launch all containers (`docker compose up -d`), and initiate the MongoDB ReplicaSet (`rs.initiate()`).

---

## 5. Ongoing Updates via `bin/zimaos-up`

Whenever you pull new code, update LaTeX packages, or change `.env` variables on ZimaOS, re-deploy with a single command (as `root`):

```bash
cd /DATA/AppData/overleaf-toolkit
./bin/zimaos-up
```

### What `bin/zimaos-up` does:
- Compiles the latest dynamic Docker Compose configuration with LAN bindings (`0.0.0.0`) and `overleaf-` container prefixes.
- Writes the updated Compose file to `/var/lib/casaos/apps/overleaf/docker-compose.yml`.
- Restarts `zimaos-app-management` service.
- Deploys changes with `docker compose up -d`.
- Verifies and maintains MongoDB ReplicaSet health.

---

## 6. Remote Development Workflow

To develop custom features, Clanker bot logic, or CSS overrides from your laptop/desktop:

1. Open your editor (VS Code, Antigravity, or Cursor).
2. Connect via **Remote - SSH**: `ssh admin@<zimaos-ip>`.
3. Open workspace directory: `/DATA/AppData/overleaf-toolkit`.
4. To reload changes while coding:
   - **Clanker code updates** (`config/clanker/`): `docker restart overleaf-clanker-bot`
   - **CSS / UI patch updates** (`config/override/`): `docker restart overleaf-sharelatex`
   - **LaTeX packages** (`config/texpackages.txt`): Run `./bin/install-tex-packages && docker restart overleaf-sharelatex`
   - **Full stack update / config reload**: Run `sudo ./bin/zimaos-up`
