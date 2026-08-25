# Failure 0001: Codex runtime authentication and Windows auth symlink

- Date: 2026-08-25
- Related Paperclip issues: RJV-134, RJV-18
- Status: mitigated; keep monitoring

## Symptoms

WMS agents entered `error` with `Authentication required`. Some Windows runs also failed while creating an `auth.json` symlink into an agent-specific Codex home with `EPERM`.

## Root cause

The Paperclip runtime did not have a valid local agent JWT secret, and per-agent Codex home isolation attempted a symlink operation unavailable in the current Windows permissions/runtime.

## Mitigation

- Persist a local `PAPERCLIP_AGENT_JWT_SECRET` in the Paperclip instance environment.
- Point failed local Codex agents at the existing local Codex home instead of creating a restricted auth symlink.
- Retry only agents without a live run.

## Verification

The WMS Work Supervisor reached `running`; after the configuration repair, 24–25 agents entered `running` and the error count reached zero at the verification checkpoint.

## Follow-up

Keep runtime repair evidence linked from RJV-134. Do not treat a queued run as proof of task completion; inspect the run result and task artifacts.
