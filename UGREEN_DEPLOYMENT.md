# Deploy Salnova on UGREEN NAS

UGREEN's current DXP models, including DXP2800, support Docker through UGOS Pro.
This deployment keeps the website, SQLite metadata, uploads, dataset versions,
model artifacts, and downloaded model cache on the NAS. CPU inference runs on the
NAS; demanding training can run on a separate laptop or NVIDIA workstation using
Salnova's remote worker.

Official references: [UGREEN Docker and software support](https://ai.ugreen.com/pages/solution-software)
and [UGREEN NAS security guidance](https://ai.ugreen.com/blogs/how-to/ensure-home-nas-network-security).

## 1. Prepare UGOS Pro

1. Update UGOS Pro, then install **Docker** from App Center.
2. Give the NAS a fixed DHCP reservation/static LAN address.
3. Create a shared folder such as `docker/salnova` on the storage pool that will
   hold application data and backups.
4. Copy this repository into that folder, excluding `.env.local`, `local_data`,
   virtual environments, `node_modules`, and local `.pt` files.

The DXP2800 is x86-64 and can build the included Linux image directly. Other
Docker-capable x86-64 UGREEN models use the same files. For an ARM model, confirm
that PyTorch provides wheels for its architecture before relying on local ML;
the web/storage portion itself is architecture-neutral.

## 2. Configure the stack

Inside the project folder:

```bash
cp .env.ugreen.example .env
```

Edit `.env` and replace the sample NAS address. Generate a secret on any computer:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Put that value in `VISIONFLOW_OTP_SECRET`. Keep it stable and include the `.env`
file in a protected configuration backup. Set the memory limit below total NAS
RAM so UGOS Pro retains working headroom.

## 3. Start from Docker Compose

Using an SSH terminal in the project folder:

```bash
docker compose -f compose.ugreen.yml config
docker compose -f compose.ugreen.yml up -d --build
docker compose -f compose.ugreen.yml ps
docker compose -f compose.ugreen.yml logs -f visionflow
```

The same Compose YAML can be imported as a project through the UGOS Pro Docker UI.
After the container becomes healthy, open the configured LAN URL, normally
`http://NAS-IP:8080`, and create the first owner.

The two bind-mounted directories are intentionally kept beside the Compose file:

- `visionflow-data`: database, uploads, versions, runs, exports, and ML caches.
- `visionflow-models`: model checkpoints downloaded or used at runtime.

Container replacement and image upgrades do not delete these directories.

## 4. Access from phones and other computers

Devices on the same LAN open the NAS URL in a normal browser; no local installation
or API setting is required. Keep port 8080 allowed only on the trusted LAN firewall.
Webcam access requires HTTPS in most browsers, while file upload and annotation
work over LAN HTTP.

For private remote access, prefer a VPN such as Tailscale rather than exposing the
UGOS administration interface or unrelated NAS services. For a genuinely public
Salnova site, use a domain and an HTTPS reverse proxy/tunnel, set the three URL and
host variables to that domain, and set `VISIONFLOW_COOKIE_SECURE=1`. Never publish
SMB, NFS, SSH, or the UGOS Pro management interface to the internet.

### Public access with Cloudflare Tunnel

This repository includes `compose.cloudflare.yml`, which runs `cloudflared` next
to Salnova. The tunnel makes an outbound connection, so router port forwarding is
not required and the UGOS administration interface remains private.

1. Add the domain to Cloudflare and open **Networking > Tunnels** in the
   Cloudflare dashboard.
2. Create a remotely-managed tunnel named `salnova-ugreen` and copy only the
   `eyJ...` token from the Docker installation command into `.env`:

   ```dotenv
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
   VISIONFLOW_PUBLIC_URL=https://salnova.example.com
   VISIONFLOW_ALLOWED_ORIGINS=https://salnova.example.com
   VISIONFLOW_ALLOWED_HOSTS=salnova.example.com,192.168.1.50
   VISIONFLOW_COOKIE_SECURE=1
   ```

3. In the tunnel's **Public Hostname** configuration, create
   `salnova.example.com` with service type **HTTP** and service URL
   `http://visionflow:8000`. The name `visionflow` is the internal Docker service,
   not the NAS IP.
4. Start and verify both containers:

   ```bash
   docker compose -f compose.ugreen.yml -f compose.cloudflare.yml config
   docker compose -f compose.ugreen.yml -f compose.cloudflare.yml up -d --build
   docker compose -f compose.ugreen.yml -f compose.cloudflare.yml ps
   docker compose -f compose.ugreen.yml -f compose.cloudflare.yml logs --tail=100 cloudflared
   ```

The tunnel token grants permission to connect to this tunnel. Do not commit or
share `.env`; rotate the token in Cloudflare if it is exposed. Keep Cloudflare
cache bypassed for `/api/*`, authentication, uploads, datasets, and model files.
Static frontend assets may use the default cache behavior.

Both services use `restart: unless-stopped`, so they return automatically after
UGREEN reboots. The public site still depends on the NAS being powered on and its
internet connection being available.

## 5. Training strategy

Small CPU inference and annotation assistance can run on the NAS. Training or
large SAM variants may consume substantial RAM and take a long time. Keep the NAS
as the always-on coordinator and storage server, then register a laptop/desktop
worker from Salnova's **Train** page. The worker downloads an immutable dataset,
trains with CPU or CUDA, and uploads `best.pt` back to the NAS.

### Running a worker unattended

The `setup.ps1` offered by the Train page installs the runtime and then runs the
worker once in the foreground, so training stops when the machine sleeps, the
worker crashes, or the terminal closes. `worker/run-worker.ps1` wraps it for
permanent use:

```powershell
# First time on a machine: store the token and register auto-start at logon.
.\worker\run-worker.ps1 -Token "<token from the Train page>" -Install

# Verify a new machine without starting work.
.\worker\run-worker.ps1 -Token "<token>" -DryRun
```

It restarts the worker with backoff when it exits, and probes several addresses
each cycle so a laptop that moves between the LAN and the internet reconnects on
its own. Edit `$DefaultServers` at the top of the script when the NAS address or
domain changes.

Copy the token from the **production** site, not from a `localhost` dev server.
Each Salnova instance issues its own tokens and keeps its own database, so a
token taken from a dev instance authenticates against that instance instead and
the worker will report `no matching job` forever.

Prefer the LAN address over the public domain where both work. Dataset downloads
are faster, and checkpoint uploads avoid the 100 MB per-request limit that
Cloudflare's free plan applies to the tunnel.

Adding another GPU machine needs no server-side change: run `setup.ps1` there,
then `run-worker.ps1` with a token. Workers claim jobs from the same queue, so
several machines can serve one NAS.

## 6. Backup and upgrades

Stop writes or briefly stop the container before taking a consistent raw SQLite
backup. Back up `.env`, `visionflow-data`, and `visionflow-models` to another device
or off-site target; RAID is not a backup.

Upgrade without deleting persistent folders:

```bash
docker compose -f compose.ugreen.yml down
git pull
docker compose -f compose.ugreen.yml up -d --build
```

Do not add `-v` to `down`, and do not delete the two bind-mounted folders. Check
`http://NAS-IP:8080/api/ready` after upgrades; it must report writable storage and
an available database.
