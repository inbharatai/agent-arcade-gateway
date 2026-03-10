# Security and Repository Protection

This project is open source (MIT), but write/merge rights are maintainer-controlled.

## Security model

- Source code is public and forkable.
- Only approved maintainers may merge to protected branches.
- Contributions happen through pull requests.

## Required GitHub repository settings

Apply these in `Settings -> Branches` for `main` (and `master` if used):

- Require a pull request before merging.
- Require approvals: at least 1 (recommended 2 for production systems).
- Require review from Code Owners.
- Dismiss stale approvals when new commits are pushed.
- Require status checks to pass before merging:
  - `lint-build-test`
- Require branches to be up to date before merging.
- Restrict who can push to matching branches (maintainers only).
- Include administrators in these restrictions.
- Optional but recommended: require signed commits.

## Required GitHub repository settings (general)

In `Settings -> General`:

- Disable force pushes and branch deletion on protected branches.
- Enable auto-delete head branches after merge.

In `Settings -> Actions`:

- Allow actions from trusted sources only.
- Require approval for workflows from first-time contributors.

In `Settings -> Secrets and variables`:

- Store deployment secrets only in GitHub Encrypted Secrets.
- Never commit secrets in code or docs.

## Reporting vulnerabilities

Please report security issues privately through GitHub Security Advisories.
Do not open public issues for exploitable vulnerabilities.
