# Coding猿 Office Beta 外测分发 Runbook

本 runbook 用于 Beta v0.4 外部测试。目标是让陌生用户能安装、首次启动、完成第一单，出错时能生成诊断材料。

## 1. 构建分发包

无 Apple 凭证时可生成 unsigned 测试包：

```sh
npm run build:mac-distribution
```

有 Developer ID 和公证凭证时：

```sh
export CODEX_OFFICE_DEVELOPER_ID_APPLICATION="Developer ID Application: Your Name (TEAMID)"
export CODEX_OFFICE_NOTARY_PROFILE="codingyuan-notary"
npm run build:mac-distribution
```

也可使用 Apple ID 三元组：

```sh
export CODEX_OFFICE_DEVELOPER_ID_APPLICATION="Developer ID Application: Your Name (TEAMID)"
export CODEX_OFFICE_APPLE_ID="apple-id@example.com"
export CODEX_OFFICE_TEAM_ID="TEAMID"
export CODEX_OFFICE_APP_PASSWORD="app-specific-password"
npm run build:mac-distribution
```

产物位置：

```text
dist/mac/Coding猿 Office.app
dist/mac-distribution/CodingYuanOffice-0.5.0-beta-mac.zip
dist/mac-distribution/CodingYuanOffice-0.5.0-beta-mac.dmg
dist/mac-distribution/distribution-report.json
```

## 2. 外测安装说明

1. 安装 Git、Node.js LTS 和 npm。
2. 打开 `CodingYuanOffice-0.5.0-beta-mac.dmg`。
3. 将 `Coding猿 Office.app` 拖到 Applications。
4. 打开 App，进入 `/office`。
5. First Run Onboarding 中选择一个本地代码项目目录。
6. 点击“跑第一单”。
7. 审查 Evidence Pack、Diff Preview、Verification、Human Gate 和 Apply Gate。
8. 只有在确认 diff 正确时，才输入精确确认语应用补丁。

安全承诺：

- 不默认扫描全盘。
- 所有读写绑定用户授权的 project root。
- Project Root Guard 阻断路径穿越和 root 外写入。
- Apply 前必须具备 diff、verification、rollback snapshot、human approval。
- 默认 human-gated，不自动写入项目文件。

## 3. 限制

- Beta v0.4 仍要求测试机安装 Node.js LTS。
- AIWC 集中日志未配置时只显示 warning，不阻断本地 beta。
- 建议第一单选择小型 Git repo；非 Git repo 会给出 warning。
- 跨仓库、大体积二进制、依赖目录、敏感配置文件不适合作为第一单。

## 4. 日志、崩溃与支持包

App 服务日志：

```text
~/Library/Logs/CodingYuanOffice/service.out.log
~/Library/Logs/CodingYuanOffice/service.err.log
```

旧 launchd 预览日志：

```text
~/Library/Logs/com.geoaifactory.codex-office.out.log
~/Library/Logs/com.geoaifactory.codex-office.err.log
```

崩溃报告：

```text
~/Library/Logs/DiagnosticReports/CodingYuanOffice*.crash
~/Library/Logs/DiagnosticReports/Coding猿 Office*.crash
```

支持包：

```text
~/Library/Application Support/CodingYuan Office/data/support-bundles
```

一键收集诊断：

```sh
npm run beta:diagnostics
```

## 5. 陌生用户 10 分钟第一单

开发者本地或外测陪跑时可以用脚本 rehearsed end-to-end：

```sh
npm run beta:first-order
```

或指定一个测试仓库：

```sh
PROJECT_ROOT=/path/to/safe/test/repo npm run beta:first-order
```

脚本会：

1. 检查 Git、Node、npm、curl。
2. 启动或复用 `http://127.0.0.1:4142`。
3. 创建或选择一个安全测试项目。
4. 运行“给 README 增加一个 Coding猿 Beta 测试段落”。
5. 生成 evidence、patch proposal、diff、verification、human gate、apply gate、report。
6. 停在人工确认前，不自动 Apply。

通过标准：

- `/office` 可打开。
- Evidence Pack 有路径。
- Diff Preview 只改 README 或创建 `README.codingape-beta.md`。
- Verification 通过或给出可读失败建议。
- Apply Gate 默认 human-gated。
- 支持包可生成。
