import type { MigrationBuilder } from "node-pg-migrate";

/** Immutable block-bound account-state observations used by Backend consumers. */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable("account_state_snapshots", {
    snapshot_id: {
      type: "uuid",
      primaryKey: true,
      notNull: true,
    },
    snapshot: {
      type: "jsonb",
      notNull: true,
      check: "snapshot ->> 'snapshotId' = snapshot_id::text",
    },
    schema_version: {
      type: "integer",
      notNull: true,
      default: 1,
      check: "schema_version = 1",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable("account_state_snapshots");
}
