# Automatic deployment to the UGREEN NAS

The NAS runs on a home LAN with no inbound ports open, so a GitHub-hosted runner
cannot reach it and a self-hosted runner cannot be exposed safely from a public
repository. Deployment is therefore inverted:

```text
push to main
   -> .github/workflows/deploy.yml  builds the image on GitHub
   -> ghcr.io/<owner>/<repo>:latest
   -> the NAS polls the registry every 3 minutes and restarts when the tag moves
```

Nothing about the NAS is stored in GitHub: no address, no key, no password. The
NAS only makes outbound requests, exactly like `cloudflared` already does.

Moving the build to CI also takes it off the NAS. Installing PyTorch on the NAS
took roughly twenty minutes per deploy; a cached CI build takes a few, and the
NAS only downloads the layers that actually changed.

## One-time setup

**1. Publish the package.** Push once to `main`, or run the workflow manually
from the Actions tab. Then open the package under the repository's *Packages*
tab and confirm its visibility. GitHub creates packages as private even for a
public repository, and a private package means the NAS pull fails with
`denied`. Either set it to public, or give the NAS a read-only token:

```bash
echo "<token with read:packages>" | docker login ghcr.io -u <username> --password-stdin
```

**2. Point the NAS at the published image.** Add this to `.env` next to the
compose files, replacing the placeholder with the repository path in lowercase
(the registry rejects uppercase):

```dotenv
VISIONFLOW_IMAGE=ghcr.io/<owner>/<repo>:latest
```

`compose.ugreen.yml` already reads `VISIONFLOW_IMAGE` and falls back to
`salnova:local`, so nothing else changes. Leaving the variable out keeps the old
build-on-the-NAS behaviour, and the deploy script exits quietly rather than
trying to pull a local tag.

**3. Install the timer.**

```bash
cd /volume1/docker/salnova
sudo chmod +x deploy/salnova-autodeploy.sh
sudo cp deploy/salnova-autodeploy.service deploy/salnova-autodeploy.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now salnova-autodeploy.timer
```

Check it:

```bash
systemctl list-timers salnova-autodeploy.timer
sudo systemctl start salnova-autodeploy.service   # run one check immediately
journalctl -u salnova-autodeploy.service -n 40 --no-pager
```

## Day to day

A push to `main` reaches the NAS within about three minutes of the image being
published. To deploy without pushing, run the workflow manually from the Actions
tab, or force a check on the NAS with `sudo systemctl start
salnova-autodeploy.service`.

The script only restarts when the image id actually changes, so the timer firing
every three minutes costs a registry metadata request and nothing else.

A failed pull is treated as routine — the NAS may be offline or a build may still
be running — and leaves the running container untouched to be retried on the next
tick. A failed *restart* is logged as fatal, because at that point the old
container may or may not still be serving.

## Rolling back

Every commit is also tagged with its SHA, so a bad deploy is undone by pinning
the previous one:

```dotenv
VISIONFLOW_IMAGE=ghcr.io/<owner>/<repo>:<previous sha>
```

then `sudo systemctl start salnova-autodeploy.service`. Put `:latest` back when
the fix ships, otherwise the NAS stays pinned and silently stops updating.

## What this does not cover

Database migrations run at application start, so a deploy that changes the schema
applies it when the new container boots. There is no automatic backup before
that: take one with the steps in `UGREEN_DEPLOYMENT.md` before shipping a
migration you cannot reverse.

GPU hosts should keep building locally. The published image is built with the CPU
PyTorch wheels because the NAS has no NVIDIA GPU.
