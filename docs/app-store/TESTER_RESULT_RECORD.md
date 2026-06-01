# Tester Result Record

Do not fabricate tester results. Record only runs completed by real external testers.

## JSONL Shape

```json
{
  "testerId": "tester-001",
  "channel": "testflight",
  "build": "1.0.0-1",
  "recordedAt": "2026-05-31T00:00:00.000Z",
  "installStatus": "passed",
  "firstLaunchStatus": "passed",
  "projectSelectionStatus": "passed",
  "apiKeyStatus": "passed",
  "firstOrderStatus": "passed",
  "diffStatus": "passed",
  "humanGateStatus": "passed",
  "applyStatus": "passed",
  "rollbackStatus": "passed",
  "supportBundleStatus": "passed",
  "supportBundlePath": "/path/to/support-bundle.json",
  "failureTags": [],
  "notes": ""
}
```

## Recording Rule

Use anonymized tester IDs. Do not store Apple IDs, API keys, private repo URLs, private source snippets, passwords, or raw crash logs with secrets.
