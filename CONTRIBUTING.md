# Contributing

Thanks for contributing to Agent Arcade.

## Workflow

1. Fork the repository.
2. Create a feature branch.
3. Make your changes.
4. Run checks locally:

```bash
npm run ci
```

5. Open a pull request.

## Governance

- `main` is protected.
- CODEOWNERS approval is required for protected paths.
- Maintainers control merge permissions.

This keeps the project open source while preventing unauthorized direct changes to protected branches.

## Local development quick start

```bash
npm run dev:gateway
npm run dev:web
```

Optional telemetry simulation:

```bash
node scripts/load/human-like-sim.mjs
```
