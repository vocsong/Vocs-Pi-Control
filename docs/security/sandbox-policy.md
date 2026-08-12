# Sandbox Policy

Non-negotiable defaults (plan §43). Any deviation requires an ADR plus an
explicit `security_grants` record and visible workspace security UI.

## Hard rules

```text
NO /run/podman/podman.sock mount
NO /var/run/docker.sock mount
NO privileged=true
NO host network
NO host PID namespace
NO host IPC namespace
NO arbitrary host mounts
NO host home mount
NO SSH key mount
NO cloud credential mount (aws/azure/gcloud)
NO host credential helpers
NO browser cookies / host password stores
NO automatic device mount
```

Pi agent processes must never be able to invoke privileged Pi Control Podman
operations. If the Podman CLI exists inside an image, it must have no useful
host Podman connection/socket.

## Profiles

| Profile | Properties |
|---|---|
| `standard` (default) | rootless; no privileged; no sockets; no host namespaces/devices; zero capabilities (`--cap-drop ALL`); `no-new-privileges`; explicit workspace bind mount only; private HOME/state; bounded CPU/mem/PIDs; loopback-only forwarded ports; unprivileged container user (uid 1000) |
| `restricted` | standard + read-only base FS where compatible; tmpfs for temp; tighter limits; approved packages/extensions only; stricter tool install policy |
| `trusted` | explicit opt-in; every added capability (mounts/devices/credentials/network) listed in workspace security settings; never auto-promoted after a failed command |

## Risk classification

| Level | Examples |
|---|---|
| `safe` | read file, git status |
| `write` | edit/create file, commit, stage |
| `destructive` | delete file, discard changes, delete workspace, force push |
| `external` | push, create PR |
| `security-sensitive` | new host mount, device/socket exposure |

Destructive and security-sensitive actions require explicit confirmation;
dangerous sandbox grants are never squeezed into a generic "are you sure".

## Application-level defense in depth

Containers are the primary boundary; the file service still resolves every
path against the workspace and verifies containment (realpath, symlink care)
before any operation (plan §29.1).

## Workspace security UI

Users can always see what a workspace may access (plan §45): profile,
sandbox runtime, host filesystem grants, runtime exclusions (socket, host
network, devices), network behavior, and advanced permissions.
