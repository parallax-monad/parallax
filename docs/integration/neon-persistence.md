# Neon persistence deployment

This runbook covers the production deployment shape for the API RunStore:
Render runs the Hono/Node service, while Neon provides the durable PostgreSQL
database. It intentionally does not automate account creation or secret
management.

## Provisioning

1. Create a Neon PostgreSQL database in the same region as the Render web
   service.
2. Copy the Neon connection string into Render as the `DATABASE_URL` secret.
   Do not commit it, put it in `render.yaml`, or print it in logs.
3. Keep `RUN_STORE_BACKEND=postgres` in the Render environment. The checked-in
   `render.yaml` declares the non-secret backend selection and leaves the
   connection string as a Render-managed secret.

Neon connection pooling is not required for this service: the API pool is
bounded (`max=5`) and uses three-second connection and five-second query /
statement timeouts.

## Startup and migrations

The Docker command invokes `apps/api/src/server.ts`. Its production process
launcher awaits PostgreSQL migrations before constructing the RunStore or
opening the HTTP listener. `node-pg-migrate` uses the `pgmigrations` table,
`singleTransaction`, and an advisory lock in wait mode, so concurrent deploys
serialize instead of running the same migration together.

Migrations are expand/contract changes. Production deploys run migrations in
the `up` direction only; do not use `db:migrate:down` as an operational
rollback because a destructive down migration can remove durable Run data.
Rollback is a code/config rollback that keeps the schema backward-compatible.

If startup migration fails, the process exits before a listener is opened. The
failure should be investigated from the deployment logs without exposing the
`DATABASE_URL` value.

## Health checks and validation

- `GET /health` is liveness only. It does not contact Neon and is the endpoint
  for UptimeRobot or another external uptime probe.
- `GET /readyz` is dependency readiness. It performs a bounded `SELECT 1`
  through the configured RunStore pool and returns `200 {"status":"ok"}` only
  when PostgreSQL is reachable. Database/configuration failures return
  `503 {"status":"not_ready"}` without the underlying error.

After the first deploy, validate in this order:

1. Confirm the Render deploy completed the migration step before the listener
   log line.
2. Open `/health` and `/readyz`; both should be `200`.
3. Confirm a real Check request creates and completes a Run, then restart the
   Render service and verify the Run remains readable from PostgreSQL.
4. Temporarily make the database unavailable in a controlled environment and
   confirm `/health` remains a liveness signal while `/readyz` returns `503`.

Do not point UptimeRobot at `/readyz`: a transient database outage should not
turn the liveness monitor into a restart loop. Use `/readyz` for deployment
smoke checks and low-frequency operational monitoring.

## Local verification

```bash
RUN_STORE_BACKEND=postgres \
DATABASE_URL=postgres://user:pass@localhost:5432/parallax \
pnpm --filter @parallax/api start
```

The same startup path runs migrations locally. For deterministic tests, use
the API unit suite; the PostgreSQL integration suite runs only when a test
database is available through `DATABASE_URL`.
