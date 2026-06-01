# Real AI Task Matrix

Stage-12 uses this matrix to evaluate whether Coding猿 can produce useful, safe diffs for small real coding tasks. This document defines tasks only. It does not claim results.

| taskId | fixture | userInput | expectedImpactFiles | riskLevel | recommendedVerification | successStandard | failureStandard | retryOnce |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AI-README-001 | simple-node-readme | 给 README 增加安装和运行说明，说明 npm test 怎么跑。 | README.md | low | npm test | README 包含 install/run/test instructions and verification still passes. | No README diff, invalid diff, or verification fails after retry. | yes |
| AI-README-002 | simple-node-readme | 给 README 增加一个 Troubleshooting 小节，解释 Node 版本不匹配时怎么处理。 | README.md | low | npm test | README has a concise troubleshooting section and no code behavior changes. | Patch touches unrelated files or verification fails. | yes |
| AI-README-003 | simple-node-readme | 把 README 的项目描述改得更清楚：这是一个小的 Node 示例项目。 | README.md | low | npm test | README description is clearer and test command still succeeds. | Diff is empty, malformed, or modifies package scripts unnecessarily. | yes |
| AI-BUG-001 | js-bugfix-button | 修复 button label 函数：没有 label 时应该返回 Save，不要返回空字符串。 | src/button.js, checks/button.mjs | low | npm test | Tests pass and getButtonLabel defaults to Save. | Sensitive file touched, wrong default, or tests fail after retry. | yes |
| AI-BUG-002 | js-bugfix-button | 修复 disabled 状态文案：disabled button 应该显示 “Save (disabled)”。 | src/button.js, checks/button.mjs | low | npm test | Tests pass and disabled state is visible in the label. | No relevant diff or verification still fails. | yes |
| AI-BUG-003 | js-bugfix-button | 给 getButtonLabel 增加 trim 处理，避免 label 前后空格出现在 UI。 | src/button.js, checks/button.mjs | low | npm test | Tests pass and label is trimmed before rendering. | Patch changes public API shape or tests fail. | yes |
| AI-TEST-001 | add-number-sum-demo | 修复 failing test：add 函数现在拼接字符串了，应该做数字相加。 | src/math.js, checks/math.mjs | low | npm test | npm test passes and add(2, 3) returns 5. | Patch hides or removes the failing test instead of fixing code. | yes |
| AI-TEST-002 | divide-zero-demo | 修复 divide 在除数为 0 时没有抛出 RangeError 的问题。 | src/math.js, checks/math.mjs | medium | npm test | divide(5, 0) throws RangeError, normal divide still works, and add tests are not a failure cause. | Patch returns Infinity, removes validation, breaks normal division, or makes add an unrelated failure cause. | yes |
| AI-TEST-003 | math-multiply-demo | 给 math 模块补一个 multiply 函数，让现有 multiply 测试通过。 | src/math.js, checks/math.mjs | medium | npm test | multiply is exported, tested, and npm test passes while add/divide remain healthy. | Incomplete export, missing product behavior, unrelated add/divide regression, or verification fails. | yes |
| AI-DOCS-001 | package-script-docs | 给 README 补充 scripts/check.js 的用途和运行命令。 | README.md, package.json | low | npm test | README explains npm run check without altering safe scripts. | Patch changes install/deploy behavior or tests fail. | yes |
| AI-DOCS-002 | package-script-docs | 给 scripts/check.js 的输出增加更清楚的成功信息。 | scripts/check.js, README.md | low | npm test | npm test passes and check output is clearer. | Patch makes script noisy or breaks the command. | yes |
| AI-DOCS-003 | package-script-docs | 在 README 增加 “No external services required” 说明。 | README.md | low | npm test | README states no external service is required. | Diff touches unrelated config or verification fails. | yes |
| AI-API-001 | small-api-field-change | 给 normalizeUser 增加 displayName 字段，优先使用 name，没有 name 时用 email。 | src/user.js, checks/user.mjs | medium | npm test | Tests pass and displayName follows name/email fallback. | Patch leaks unrelated fields or tests fail. | yes |
| AI-API-002 | small-api-field-change | 给 normalizeUser 增加输入校验：缺少 email 时抛 TypeError。 | src/user.js, checks/user.mjs | medium | npm test | Missing email throws TypeError and existing behavior remains. | Patch accepts invalid users or fails verification. | yes |
| AI-API-003 | small-api-field-change | 给 normalizeUser 增加 role 默认值 viewer。 | src/user.js, checks/user.mjs | low | npm test | Tests pass and role defaults to viewer when missing. | Patch changes required input shape or tests fail. | yes |

Evaluation rules:

- Do not apply patches to the user's real project.
- Do not send whole project trees to a model.
- Do not read or send `.env`, private keys, wallet files, certificates, or secret folders.
- Do not count Demo Only as an AI success.
- One automatic retry is allowed only when the task row says `yes`.
- A generated diff is usable only if it passes verification in a sandbox and remains human-gated before project writes.
- Each fixture should isolate one primary failure. If baseline verification fails for an unrelated reason, the evaluator should mark the fixture invalid instead of blaming the model patch.
