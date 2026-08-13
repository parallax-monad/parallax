import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.createTable("check_runs", {
    run_id: {
      type: "text",
      primaryKey: true,
      notNull: true,
      check: "btrim(run_id) <> ''",
    },
    parent_run_id: {
      type: "text",
      references: "check_runs(run_id)",
      onDelete: "RESTRICT",
    },
    lifecycle_state: {
      type: "text",
      notNull: true,
      check: "lifecycle_state IN ('started', 'completed', 'failed')",
    },
    failure_code: {
      type: "text",
      // Keep this historical migration snapshot aligned with
      // CHECK_RUN_FAILURE_CODES; the PostgreSQL integration test checks it.
      check:
        "failure_code IS NULL OR failure_code IN ('UNSUPPORTED', 'AGENT_FLOW_ERROR', 'INVALID_AGENT_FLOW_RESPONSE')",
    },
    intent: {
      type: "jsonb",
      notNull: true,
    },
    result: {
      type: "jsonb",
    },
    schema_version: {
      type: "integer",
      notNull: true,
      default: 1,
      check: "schema_version = 1",
    },
    started_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
    finished_at: {
      type: "timestamptz",
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  pgm.addConstraint("check_runs", "check_runs_parent_not_self", {
    check: "parent_run_id IS NULL OR parent_run_id <> run_id",
  });
  pgm.addConstraint("check_runs", "check_runs_lifecycle_payload", {
    check: `
      (lifecycle_state = 'started' AND result IS NULL AND failure_code IS NULL)
      OR
      (lifecycle_state = 'completed' AND result IS NOT NULL AND failure_code IS NULL)
      OR
      (lifecycle_state = 'failed' AND result IS NOT NULL AND failure_code IS NOT NULL)
    `,
  });
  pgm.createIndex("check_runs", "parent_run_id", {
    name: "check_runs_parent_run_id_idx",
  });
  pgm.createIndex("check_runs", "started_at", {
    name: "check_runs_started_at_idx",
  });
  pgm.createIndex("check_runs", "updated_at", {
    name: "check_runs_updated_at_idx",
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable("check_runs");
}
