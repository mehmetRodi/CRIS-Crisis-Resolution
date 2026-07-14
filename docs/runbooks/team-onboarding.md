# Runbook: Developer onboarding (AWS + local dev)

For each of the 5 developers, once. Gets you an individual AWS login (no shared
keys, no root) and a personal, disposable backend sandbox. The account topology
and identity model are in [ADR-0017](../adr/0017-aws-account-identity-and-region-topology.md);
the one-time account wiring an admin does is in [`aws-connection.md`](aws-connection.md).

> **We never use the AWS root user or static access keys.** You sign in through
> IAM Identity Center (SSO), which issues short-lived credentials tied to _you_.

## Prerequisites (install once)

- **AWS CLI v2** — `aws --version` should print `aws-cli/2.x`.
- **Node.js** — the version in [`.nvmrc`](../../.nvmrc) (`nvm use`).
- **Git + repo access** — clone `mehmetRodi/CRIS-Crisis-Resolution`.

## 1. Accept your Identity Center invitation

An admin (running [`scripts/aws/10-identity-center.sh`](../../scripts/aws/README.md))
adds you to the **CrisisMapDevelopers** group. You'll get an email:

1. Click **Accept invitation**, set a password.
2. **Register an MFA device** (authenticator app or passkey) — required.
3. Bookmark the **AWS access portal URL** the admin shares
   (`https://<something>.awsapps.com/start`). That's your sign-in page.

## 2. Configure the CLI for SSO

```bash
aws configure sso
# SSO start URL: <the access portal URL>
# SSO region:    eu-central-1
# On the account picker, choose the account, then the CrisisMapDeveloper role.
# Name the profile:  crisismap
```

Then, each working session (the token lasts a few hours):

```bash
aws sso login --profile crisismap
export AWS_PROFILE=crisismap
aws sts get-caller-identity   # should show your assumed CrisisMapDeveloper role — NOT :root
```

> Tip: add `export AWS_PROFILE=crisismap` to your shell profile so every terminal
> is pointed at the right identity.

## 3. Enable Bedrock model access (once, if not already on)

The classifier calls Claude via the EU inference profile
`eu.anthropic.claude-haiku-4-5-...`. In the **Bedrock console → Model access**
(region `eu-central-1`), confirm the Anthropic Claude family is enabled. If it
isn't, request access (usually granted immediately). See ADR-0017 for why EU +
inference-profile.

## 4. Stand up your personal sandbox

```bash
npm install                     # from the repo root, once
cd apps/web
npx ampx sandbox                # deploys YOUR isolated backend stack
```

This provisions a personal copy of the backend (Cognito, AppSync, DynamoDB, the
Lambdas + the classification pipeline) and writes `amplify_outputs.json` — which
is **git-ignored; never commit it**. Leave `npx ampx sandbox` running for
hot-reload while you work; in another terminal run the frontend:

```bash
npm run dev                     # http://localhost:5173, from the repo root
```

## 5. Tear it down when you're done

Sandboxes cost money and drift. Delete yours when you stop working on the backend:

```bash
cd apps/web
npx ampx sandbox delete
```

## Guardrails to know

- **Your sandbox is yours.** Stacks are keyed per-developer, so five sandboxes
  coexist without collision. Never point your sandbox at someone else's stack.
- **Single account, shared with production.** Your `CrisisMapDeveloper` role is
  scoped so sandbox IAM roles (`amplify-*`) work, but it is **not** admin — you
  can't touch the production stack's IAM. Deploys to production go **only**
  through CI on `main` (never `ampx sandbox`/`pipeline-deploy` by hand).
- **No PII in logs or prompts.** Reporter identity/contact never enters logs, the
  queue, or model prompts (design doc §5.4.1/§5.6). Confirm this holds before
  pointing a sandbox at anything resembling real data.
- **Read the conventions.** [`docs/conventions.md`](../conventions.md) and
  [`CLAUDE.md`](../../CLAUDE.md) — TypeScript strict, ADR-per-decision, ticket
  ownership.

## Troubleshooting

| Symptom                                     | Fix                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `aws sts get-caller-identity` shows `:root` | You're on root creds. Stop; use `aws sso login --profile crisismap`.                                                     |
| `ExpiredToken` mid-session                  | `aws sso login --profile crisismap` again.                                                                               |
| `ampx sandbox` AccessDenied on IAM          | You're outside the `amplify-*` name scope, or your role isn't `CrisisMapDeveloper`. Check `aws sts get-caller-identity`. |
| Bedrock `AccessDenied` / model not found    | Model access not enabled in `eu-central-1`, or you set a non-`eu.` model id. See step 3 + ADR-0017.                      |
| `amplify_outputs.json` missing              | Start `npx ampx sandbox`; it generates the file.                                                                         |
