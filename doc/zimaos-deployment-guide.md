# ZimaOS Deployment & Development Guide

This guide documents how to deploy, test, and manage our custom Overleaf + Clanker AI stack on a remote machine running **ZimaOS** (or CasaOS).

---

## 1. Architecture Overview

- **ShareLaTeX (Overleaf Community Edition Plus)**: Runs with custom TeX Live packages (`sharelatex/sharelatex:ext-ce-tex-packages-installed`), customized brand logo, theme-responsive CSS mask, and Pug view patches (`overleaf-sharelatex`).
- **Clanker Bot Daemon**: Runs on `node:20-alpine`, orchestrating real-time WebSocket collaborator participation, LLM queries, and an interactive web dashboard on port `5050` (`overleaf-clanker-bot`).
- **Database Backend**: MongoDB 8.0 (`overleaf-mongo`, ReplicaSet mode for document history) + Redis 7.4 (`overleaf-redis`, AOF persistence).
- **ZimaOS Web App Tile**: Native GUI management (start/stop/restart/logs and 1-click web launch at `http://<zimaos-ip>:8008`).

---

## 2. Initial Setup on Remote ZimaOS Host

SSH into your ZimaOS machine (`admin@<zimaos-ip>`):

```bash
# 1. Navigate to AppData and clone this repository
cd /DATA/AppData
git clone <your-repo-url> overleaf-toolkit
cd overleaf-toolkit

# 2. Pull the base Community Edition Plus (CEP) image & tag it
docker pull overleafcep/sharelatex:6.2.0-ext-v5.0
docker tag overleafcep/sharelatex:6.2.0-ext-v5.0 sharelatex/sharelatex:ext-ce

# 3. Build the custom LaTeX package image (reads config/texpackages.txt)
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

# In ZimaOS SSH: Extract archive
cd /DATA/AppData/overleaf-toolkit
tar -xzvf overleaf_backup.tar.gz
```

---

## 4. Test the System via CLI

Before creating the ZimaOS Web App, test the entire stack from the terminal:

```bash
# 1. Start all containers in background
bin/up -d

# 2. Check container health status
docker ps

# 3. Test HTTP endpoints
curl -sI http://localhost:8008/login | grep "HTTP"       # Should return HTTP/1.1 200 OK
curl -s http://localhost:5050/api/data | head -c 100     # Should return Clanker JSON pool

# 4. Inspect Clanker & Overleaf logs
docker logs overleaf-clanker-bot --tail 20
docker logs overleaf-sharelatex --tail 20

# 5. Stop the CLI stack before registering to ZimaOS App Management
bin/stop
```

---

## 5. Register & Install ZimaOS Custom App (GUI)

To register Overleaf as a native ZimaOS App tile:

### Method A: Direct File Injection (Recommended for Terminal)
On ZimaOS (as `root` or `sudo`):
```bash
cd /DATA/AppData/overleaf-toolkit

# 1. Create ZimaOS app folder
mkdir -p /var/lib/casaos/apps/overleaf/
touch /var/lib/casaos/apps/overleaf/docker-compose.yml

# 2. Generate and write the resolved Compose YAML
bin/generate-zimaos-app > /var/lib/casaos/apps/overleaf/docker-compose.yml

# 3. Restart ZimaOS app management service to register the new tile
systemctl restart zimaos-app-management

# 4. Launch the stack
cd /var/lib/casaos/apps/overleaf/
docker compose up -d
```

### Method B: Via ZimaOS Web Dashboard UI
1. Open the ZimaOS web dashboard in your browser (`http://<zimaos-ip>`).
2. Click **"+"** (Top-right of dashboard grid) $\to$ **"Install a custom app"**.
3. Click the **"Import"** icon in the top-right corner of the popup modal.
4. Paste the output from `./bin/generate-zimaos-app`.
5. Click **Submit** $\to$ **Install**.

---

## 6. Remote Development Workflow

To continue developing custom features, Clanker bot logic, or CSS overrides:

1. Open your editor (VS Code, Antigravity, or Cursor).
2. Connect via **Remote - SSH**: `ssh admin@<zimaos-ip>`.
3. Open workspace directory: `/DATA/AppData/overleaf-toolkit`.
4. To reload changes:
   - **Clanker code updates** (`config/clanker/`): `docker restart overleaf-clanker-bot`
   - **CSS / UI patch updates** (`config/override/`): `docker restart overleaf-sharelatex`
   - **LaTeX packages** (`config/texpackages.txt`): Run `./bin/install-tex-packages && docker restart overleaf-sharelatex`
