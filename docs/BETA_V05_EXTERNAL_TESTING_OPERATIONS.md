# Beta v0.5 真实外测运营闭环

目标：把 Mac Beta 从“能打包”推进到“能运营外测”。v0.5 追踪四件事：

- Developer ID 签名和 notarization 是否真实完成。
- 是否有 3-5 位陌生测试者跑完 runbook。
- 每位测试者是否提交 support bundle。
- 第一单成功率，以及安装失败、Node 缺失、4142 端口冲突、第一次 Apply 卡点。

## 1. 可信分发 Gate

检查本机证书：

```sh
security find-identity -p codesigning -v
```

构建并公证：

```sh
export CODEX_OFFICE_DEVELOPER_ID_APPLICATION="Developer ID Application: Your Name (TEAMID)"
export CODEX_OFFICE_NOTARY_PROFILE="codingyuan-notary"
npm run build:mac-distribution
```

通过标准：

- `dist/mac-distribution/distribution-report.json` 中 `signing.status` 为 `signed`。
- `notarization.status` 为 `notarized`。
- `/office` 的 Beta Ops Dashboard 不再显示 Developer ID 或 notarization 阻断。

## 2. 测试者记录

每位测试者完成 runbook 后，记录一次结果：

```sh
TESTER_ID=tester-01 \
RUNBOOK_STATUS=completed \
INSTALL_STATUS=installed \
NODE_STATUS=available \
PORT_STATUS=clear \
FIRST_ORDER_STATUS=passed \
FIRST_APPLY_STATUS=blocked \
NOTES="First Apply stopped at exact confirmation, expected for safety." \
npm run beta:record-tester -- --support-bundle /path/to/support-bundle.json
```

常用失败标记：

```sh
FAILURE_TAGS=install_failed
FAILURE_TAGS=node_missing
FAILURE_TAGS=port_4142_busy
FAILURE_TAGS=first_apply_blocked
```

数据写入：

```text
data/beta-ops/tester-runs.jsonl
data/beta-ops/support-bundles/
```

## 3. 运营仪表盘

打开：

```text
http://127.0.0.1:4142/office
```

查看 `Beta Ops` 面板：

- 可信分发：Developer ID、签名、公证。
- 外测样本：测试者数量、runbook 完成数、支持包数量。
- 第一单：attempts、successes、success rate。
- 卡点：安装失败、Node 缺失、4142 端口冲突、第一次 Apply 卡点。

通过标准：

- 测试者数量 >= 3。
- 支持包数量 >= 已完成测试者数量，最低 3 份。
- First-order success rate >= 80%。
- 可信分发为 signed + notarized。

## 4. 复盘节奏

每一轮 3-5 人结束后：

1. 查看 Beta Ops Dashboard。
2. 打开失败测试者支持包。
3. 优先修复最高频卡点。
4. 重新构建 DMG。
5. 用新 tag 开下一轮。
