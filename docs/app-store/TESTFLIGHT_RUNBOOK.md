# TestFlight External Tester Runbook

## Goal

Validate that a stranger can install Coding猿 Office, launch it, choose a project, run the first safe task, review the diff, approve through Human Gate, apply or roll back safely, and generate a support bundle.

## Success Criteria

- Install succeeds.
- First launch succeeds.
- Project folder selection succeeds.
- API key configuration or BYO-key confirmation succeeds.
- Safe first-order task succeeds.
- Diff is visible.
- Human Gate is usable.
- Apply and rollback are usable.
- Support bundle can be generated.

## Tester Steps

1. Install the TestFlight build.
2. Launch Coding猿 Office.
3. Choose a disposable local test project.
4. Configure a test API key if required.
5. Run the safe first-order task: `给 README 增加一个 Coding猿 Beta 测试段落`.
6. Confirm the evidence pack and diff preview are understandable.
7. Exercise Human Gate and Apply Gate.
8. Apply the approved patch only if the test project is disposable.
9. Run rollback.
10. Generate a support bundle.

## Failure Tags

Use these tags when recording results:

- `install_failed`
- `first_launch_failed`
- `project_selection_failed`
- `api_key_failed`
- `first_order_failed`
- `diff_missing`
- `human_gate_failed`
- `apply_failed`
- `rollback_failed`
- `support_bundle_failed`
