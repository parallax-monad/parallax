*** Begin Patch
*** Update File: apps/api/src/backend/chain-adapter.test.ts
@@
-    const signal = AbortSignal.abort("caller-cancelled");
+    const signal = new AbortController().signal;
*** End Patch