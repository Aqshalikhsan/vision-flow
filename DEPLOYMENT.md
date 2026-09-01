# Salnova deployment

Salnova is served as one same-origin web application: Caddy terminates HTTP/HTTPS,
then forwards UI and API traffic to the private application container. Browsers,
phones, tablets, and remote training workers only need the public URL; they never
need a device-specific API address.

## Requirements

- A Linux server, NAS, cloud VM, or Windows/macOS machine with Docker Engine and
  Docker Compose v2.
- At least 4 GB RAM for normal annotation. Use 8 GB or more for local ML inference.
- Persistent disk space for uploads, versions, checkpoints, and model caches.
- For public hosting: a domain pointed to the server and inbound TCP 80/443 plus
  UDP 443. Caddy obtains and renews HTTPS certificates automatically.

The default image is CPU-compatible. A separate Windows/Linux/macOS worker can do
training, so the web host does not have to own a GPU.

## Public HTTPS deployment

1. Copy `.env.production.example` to `.env`.
2. Replace `salnova.example.com` with the real domain in all three URL/host values.
3. Generate a stable `VISIONFLOW_OTP_SECRET`; do not change it on every restart.
4. Optionally configure SMTP and Gemini credentials.
5. Start the stack:

   ```bash
   docker compose up -d --build
   docker compose ps
   docker compose logs -f app gateway
   ```

Open the configured HTTPS URL and create the first owner account. Do not expose
container port 8000; only Caddy publishes ports to the host.

`VISIONFLOW_ALLOW_SELF_REGISTRATION=0` is the safe production default. The first
owner can still be created on an empty installation, but later accounts must be
provisioned by a trusted workspace administrator. Setting it to `1` opens public
signup into the same shared workspace; it does not create isolated customer
tenants.

## LAN deployment without a domain

Set these values in `.env`, replacing the address with the server's LAN IP:

```dotenv
VISIONFLOW_ADDRESS=:80
VISIONFLOW_PUBLIC_URL=http://192.168.1.50
VISIONFLOW_ALLOWED_ORIGINS=http://192.168.1.50
VISIONFLOW_ALLOWED_HOSTS=192.168.1.50,localhost,127.0.0.1
VISIONFLOW_COOKIE_SECURE=0
VISIONFLOW_OTP_SECRET=replace-with-a-stable-random-secret
```

Run `docker compose up -d --build`, then open `http://192.168.1.50` from another
device on the same network. Camera/webcam browser APIs normally require HTTPS;
file upload and annotation continue to work over LAN HTTP.

## NVIDIA GPU host

Install a compatible NVIDIA driver and NVIDIA Container Toolkit, verify Docker can
see the GPU, then add the GPU overlay:

```bash
docker compose -f compose.yml -f compose.gpu.yml up -d --build
```

Salnova detects CUDA at runtime and otherwise falls back to CPU. Model checkpoints
and Hugging Face/Torch/Ultralytics caches are stored in persistent Docker volumes,
so container rebuilds do not download everything again.

## Persistence, updates, and backups

The stack creates four named volumes. The important application state is in
`salnova-data` and `salnova-models`; Caddy's two volumes contain TLS state. Back up
all four before an upgrade. SQLite requires a single `app` replica, so do not use
`docker compose up --scale app=...`. Scale compute with Salnova's remote worker
support instead. WAL mode and a configurable busy timeout are enabled for
concurrent browser sessions on that single application replica.

To update without deleting data:

```bash
git pull
docker compose build --pull
docker compose up -d
```

Do not run `docker compose down -v` unless intentionally deleting all persistent
application and certificate data.

## Health checks

- `/api/health`: lightweight process liveness and application version.
- `/api/ready`: database connectivity and persistent-storage writability.

The reverse proxy waits for readiness before routing traffic.
