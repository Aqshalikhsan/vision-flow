# Workspace handoff

At the beginning of every Codex session in this workspace, read
`gpu-diagnostics/ONGOING.md` before taking action. Treat it as the persistent
handoff for the GPU stability investigation. Inspect the latest files in
`gpu-diagnostics/` when the user asks to continue, check status, or reports a
black screen/restart.

Do not modify application code for the GPU investigation unless the user makes
a separate explicit request. Diagnostic checks should be read-only by default.
Update `gpu-diagnostics/ONGOING.md` after material findings or changes so the
next session can continue without asking the user to repeat context.
