# Tenderly real fixture slots

As of 2026-09-17, `CREDENTIALED_PROBE=BLOCKED_NO_LOCAL_CREDENTIAL`, `CREDENTIALS_PRESENT=NO`, `REAL_TENDERLY_REQUEST_SENT=NO`, and `REAL_TENDERLY_FIXTURES=NONE`. The canonical #63 Camelot V3 transaction is unavailable in main, and no #63 real-evidence branch or pull request was published at capture time. No Tenderly API request was made. There are no real success, revert, unsupported, authentication, rate-limit, timeout, or incomplete-response fixtures. Do not treat deterministic test payloads as real responses.

When credentials and exact transaction material become available, capture each case in this directory with `real: true`, qualification, network, relationship to PreparedExecution, semantic request fields, capture time, block/state context, allowlisted response subset, redaction notes, limitations, and reproduction steps. Never store an access key, header, private endpoint, cookie, or raw response dump here.
