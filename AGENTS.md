# Workspace handoff

Read `OPERASI_SALNOVA.md` before touching the NAS, Cloudflare, or anything about
deployment. It records the live deployment rather than the generic instructions
in `PANDUAN_UGREEN_CLOUDFLARE.md`: real addresses, the decisions already made
deliberately, and the traps that have each cost an hour — the SSH username with
a space in it, the chrooted SFTP root, the router's cached SERVFAIL, and the
dev server that looks exactly like production but has its own database.

At the beginning of every Codex session in this workspace, read
`gpu-diagnostics/ONGOING.md` before taking action. Treat it as the persistent
handoff for the GPU stability investigation. Inspect the latest files in
`gpu-diagnostics/` when the user asks to continue, check status, or reports a
black screen/restart.

Do not modify application code for the GPU investigation unless the user makes
a separate explicit request. Diagnostic checks should be read-only by default.
Update `gpu-diagnostics/ONGOING.md` after material findings or changes so the
next session can continue without asking the user to repeat context.
