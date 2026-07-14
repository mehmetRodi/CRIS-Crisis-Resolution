# `scripts/aws/` — one-time AWS wiring

Idempotent scripts that take this repo from **dormant** (no cloud resources) to a
live backend deployed by CI, plus a 5-developer team on IAM Identity Center. They
implement [`docs/runbooks/aws-connection.md`](../../docs/runbooks/aws-connection.md)
and the decisions in [ADR-0017](../../docs/adr/0017-aws-account-identity-and-region-topology.md).

## Before you start

- **Do NOT run these as the account root user.** Every script refuses root. Get
  onto an admin Identity Center login first (see step 1 below for the bootstrap
  exception).
- Tools required: AWS CLI v2, GitHub CLI (`gh` logged in with `repo` scope),
  Node.js (per `.nvmrc`).
- Defaults target **`eu-central-1`** and repo **`mehmetRodi/CRIS-Crisis-Resolution`**.
  Override any value via env, e.g. `AWS_REGION=eu-west-1 ./30-deploy-role.sh`
  (see `lib.sh`).

## Order

| Step | Script                   | What it does                                                                  | Idempotent |
| ---- | ------------------------ | ----------------------------------------------------------------------------- | ---------- |
| 0    | `00-preflight.sh`        | Verify tooling, identity (not root), region + Bedrock access                  | read-only  |
| 1    | `10-identity-center.sh`  | Org → Identity Center → `CrisisMapDeveloper` permission set → group → 5 users | ✅         |
| 2    | `20-bootstrap.sh`        | `cdk bootstrap` + create the Amplify app                                      | ✅         |
| 3    | `30-deploy-role.sh`      | Deploy the OIDC provider + branch-scoped deploy role (CloudFormation)         | ✅         |
| 4    | `40-configure-github.sh` | Set the repo variables + secrets the Deploy workflow needs                    | ✅         |
| 5    | `50-first-deploy.sh`     | Manually dispatch + watch the first backend deploy                            | n/a        |
| 6    | `60-subscribe-alarms.sh` | Subscribe an endpoint to the ops alarm SNS topic                              | ✅         |

Steps 1 (team) and 2–6 (CD path) are independent — do them in either order.

## The one manual step

Enabling the **IAM Identity Center instance** is console-only (AWS exposes no
create-instance API for the org-level directory). `10-identity-center.sh` detects
this, prints the exact console click-path, and exits so you can re-run it after.

## Team roster

`10-identity-center.sh` reads developers from `developers.txt` (git-ignored).
Copy `developers.example.txt` → `developers.txt` and fill in your 5 devs.

## Undo

- Deploy role / OIDC provider: `aws cloudformation delete-stack --stack-name crisismap-github-oidc-deploy-role`
- A personal sandbox: `cd apps/web && npx ampx sandbox delete`
- See the teardown section of `docs/runbooks/aws-connection.md` for full environment decommission.
