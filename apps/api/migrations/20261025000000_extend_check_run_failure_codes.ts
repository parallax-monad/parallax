import type { MigrationBuilder } from "node-pg-migrate";

const originalFailureCodes =
  "'UNSUPPORTED', 'AGENT_FLOW_ERROR', 'INVALID_AGENT_FLOW_RESPONSE'";
const currentFailureCodes = `${originalFailureCodes}, 'SOURCE_MISMATCH', 'FORK_STATE_CHANGED'`;

export function up(pgm: MigrationBuilder): void {
  pgm.dropConstraint("check_runs", "check_runs_failure_code_check");
  pgm.addConstraint("check_runs", "check_runs_failure_code_check", {
    check: `failure_code IS NULL OR failure_code IN (${currentFailureCodes})`,
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM check_runs
        WHERE failure_code IS NOT NULL
          AND failure_code NOT IN (${originalFailureCodes})
      ) THEN
        RAISE EXCEPTION
          'Cannot roll back failure-code constraint while newer failure codes are present';
      END IF;
    END;
    $$;
  `);
  pgm.dropConstraint("check_runs", "check_runs_failure_code_check");
  pgm.addConstraint("check_runs", "check_runs_failure_code_check", {
    check: `failure_code IS NULL OR failure_code IN (${originalFailureCodes})`,
  });
}
