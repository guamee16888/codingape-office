import Cocoa
import WebKit

@main
final class CodingYuanOfficeApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler {
    private let port = 4142
    private var window: NSWindow?
    private var webView: WKWebView?
    private var serviceProcess: Process?
    private var serviceOwnedByApp = false
    private var servicePolls = 0
    private var startupFailureTitle = ""
    private var startupFailureDetail = ""
    private var startupFailureFix = ""
    private var stdoutLogHandle: FileHandle?
    private var stderrLogHandle: FileHandle?
    private var scopedProjectAccess: [String: URL] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        openOfficeWindow()
        restoreSecurityScopedProjectBookmarks()
        startLocalServiceIfNeeded()
        waitForLocalService()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopOwnedLocalService()
    }

    func windowWillClose(_ notification: Notification) {
        NSApp.terminate(nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "codingYuanOffice",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String,
              let requestId = body["requestId"] as? String else {
            return
        }

        if action == "chooseProjectFolder" {
            chooseProjectFolder(requestId: requestId)
        }
    }

    private func openOfficeWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.userContentController.add(self, name: "codingYuanOffice")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        self.webView = webView

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Coding猿 Office"
        window.center()
        window.contentView = webView
        window.delegate = self
        window.makeKeyAndOrderFront(nil)
        self.window = window

        webView.loadHTMLString("""
        <html><body style="margin:0;background:#05070a;color:#f8fbff;font:15px -apple-system;padding:28px">
        <strong>Coding猿 Office 正在启动本地服务...</strong>
        <p>如果持续超过 20 秒，请确认 Node.js 可用。</p>
        </body></html>
        """, baseURL: nil)
    }

    private func waitForLocalService() {
        if isLocalServiceHealthy() {
            webView?.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/office")!))
            return
        }

        servicePolls += 1
        if servicePolls > 60 || !startupFailureTitle.isEmpty {
            renderStartupFailurePage()
            return
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            self?.waitForLocalService()
        }
    }

    private func startLocalServiceIfNeeded() {
        if isLocalServiceHealthy() {
            serviceOwnedByApp = false
            return
        }

        let nodePath = bundledResourceText("node-path") ?? "/usr/bin/env node"
        guard let launch = nodeLaunchCommand(nodePath) else {
            startupFailureTitle = "Node.js 未找到"
            startupFailureDetail = "Coding猿 Office 找不到可执行的 Node.js：\(nodePath)"
            startupFailureFix = "安装 Node.js LTS；如果使用 Homebrew，请确认 /opt/homebrew/bin/node 或 /usr/local/bin/node 可用。"
            return
        }

        if let owner = portOwnerDescription(), !owner.isEmpty {
            startupFailureTitle = "4142 端口被占用"
            startupFailureDetail = owner
            startupFailureFix = "退出旧的 Coding猿 Office 或运行 lsof -nP -iTCP:4142 -sTCP:LISTEN 找到占用进程后重试。"
            return
        }

        let process = Process()
        process.executableURL = launch.executable
        process.arguments = launch.arguments + ["server.js"]
        process.currentDirectoryURL = URL(fileURLWithPath: bundledResourceText("repo-root") ?? FileManager.default.currentDirectoryPath)
        attachServiceLogs(process)

        var environment = ProcessInfo.processInfo.environment
        environment["CODING_YUAN_OFFICE_ROOT"] = bundledResourceText("repo-root") ?? FileManager.default.currentDirectoryPath
        environment["CODING_YUAN_OFFICE_NODE"] = nodePath
        environment["CODEX_OFFICE_DATA_DIR"] = appSupportDataDirectory()
        environment["CODEX_OFFICE_LOG_DIR"] = logDirectory()
        environment["PORT"] = "\(port)"
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + (environment["PATH"] ?? "")
        process.environment = environment

        do {
            try process.run()
            serviceProcess = process
            serviceOwnedByApp = true
        } catch {
            serviceOwnedByApp = false
            startupFailureTitle = "本地服务启动失败"
            startupFailureDetail = error.localizedDescription
            startupFailureFix = "请在终端运行 npm run dev 查看错误，或修复后重新打开 App。"
        }
    }

    private func renderStartupFailurePage() {
        let title = startupFailureTitle.isEmpty ? "本地服务启动失败" : startupFailureTitle
        let detail = startupFailureDetail.isEmpty ? "Coding猿 Office 没有在 4142 端口拿到健康响应。" : startupFailureDetail
        let fix = startupFailureFix.isEmpty ? "请确认 Node.js 可用、4142 端口未被占用，然后重新打开 App。" : startupFailureFix
        webView?.loadHTMLString("""
        <html><body style="margin:0;background:#05070a;color:#f8fbff;font:15px -apple-system;padding:28px;line-height:1.55">
        <strong>\(escapeHtml(title))</strong>
        <p>\(escapeHtml(detail))</p>
        <p><b>修复建议：</b>\(escapeHtml(fix))</p>
        <p><b>日志路径：</b>\(escapeHtml(logDirectory()))</p>
        <p>服务启动后，可在 Beta 支持中心生成 support bundle。</p>
        </body></html>
        """, baseURL: nil)
    }

    private func stopOwnedLocalService() {
        if serviceOwnedByApp, let process = serviceProcess, process.isRunning {
            process.terminate()
        }
        stdoutLogHandle?.closeFile()
        stderrLogHandle?.closeFile()
        for url in scopedProjectAccess.values {
            url.stopAccessingSecurityScopedResource()
        }
        scopedProjectAccess.removeAll()
    }

    private func chooseProjectFolder(requestId: String) {
        let panel = NSOpenPanel()
        panel.title = "Choose a Coding猿 project folder"
        panel.message = "Coding猿 Office will only read and write inside the project folder you choose."
        panel.prompt = "Choose Project"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false

        panel.begin { [weak self] response in
            guard let self else { return }
            guard response == .OK, let url = panel.url else {
                self.sendNativeFolderPickerResult(requestId: requestId, payload: [
                    "ok": false,
                    "status": "cancelled",
                    "error": "Folder picker was cancelled."
                ])
                return
            }

            do {
                let bookmark = try url.bookmarkData(
                    options: [.withSecurityScope],
                    includingResourceValuesForKeys: nil,
                    relativeTo: nil
                )
                if url.startAccessingSecurityScopedResource() {
                    self.scopedProjectAccess[url.path] = url
                }
                self.sendNativeFolderPickerResult(requestId: requestId, payload: [
                    "ok": true,
                    "status": "selected",
                    "path": url.path,
                    "name": url.lastPathComponent.isEmpty ? "Local Project" : url.lastPathComponent,
                    "securityScopedBookmark": bookmark.base64EncodedString(),
                    "authorizationSource": "mac_app_security_scoped_bookmark"
                ])
            } catch {
                self.sendNativeFolderPickerResult(requestId: requestId, payload: [
                    "ok": false,
                    "status": "blocked",
                    "error": error.localizedDescription
                ])
            }
        }
    }

    private func sendNativeFolderPickerResult(requestId: String, payload: [String: Any]) {
        guard let payloadData = try? JSONSerialization.data(withJSONObject: payload),
              let payloadJson = String(data: payloadData, encoding: .utf8),
              let requestIdData = try? JSONSerialization.data(withJSONObject: requestId),
              let requestIdJson = String(data: requestIdData, encoding: .utf8) else {
            return
        }
        webView?.evaluateJavaScript("window.__codingYuanNativeFolderPickerResult(\(requestIdJson), \(payloadJson));")
    }

    private func restoreSecurityScopedProjectBookmarks() {
        let registryURL = URL(fileURLWithPath: appSupportDataDirectory()).appendingPathComponent("local-projects.json")
        guard let data = try? Data(contentsOf: registryURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let projects = json["projects"] as? [[String: Any]] else {
            return
        }

        for project in projects {
            guard let encodedBookmark = project["securityScopedBookmark"] as? String,
                  !encodedBookmark.isEmpty,
                  let bookmarkData = Data(base64Encoded: encodedBookmark) else {
                continue
            }

            do {
                var isStale = false
                let url = try URL(
                    resolvingBookmarkData: bookmarkData,
                    options: [.withSecurityScope, .withoutUI],
                    relativeTo: nil,
                    bookmarkDataIsStale: &isStale
                )
                if !isStale && url.startAccessingSecurityScopedResource() {
                    scopedProjectAccess[url.path] = url
                }
            } catch {
                continue
            }
        }
    }

    private func nodeLaunchCommand(_ nodePath: String) -> (executable: URL, arguments: [String])? {
        let trimmed = nodePath.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed == "node" || trimmed == "/usr/bin/env node" {
            return (URL(fileURLWithPath: "/usr/bin/env"), ["node"])
        }
        if FileManager.default.isExecutableFile(atPath: trimmed) {
            return (URL(fileURLWithPath: trimmed), [])
        }
        return nil
    }

    private func appSupportDataDirectory() -> String {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        let url = base.appendingPathComponent("CodingYuan Office", isDirectory: true).appendingPathComponent("data", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url.path
    }

    private func logDirectory() -> String {
        let base = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library")
        let url = base.appendingPathComponent("Logs", isDirectory: true).appendingPathComponent("CodingYuanOffice", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url.path
    }

    private func attachServiceLogs(_ process: Process) {
        stdoutLogHandle = appendLogHandle("service.out.log")
        stderrLogHandle = appendLogHandle("service.err.log")
        if let stdoutLogHandle {
            process.standardOutput = stdoutLogHandle
        }
        if let stderrLogHandle {
            process.standardError = stderrLogHandle
        }
    }

    private func appendLogHandle(_ name: String) -> FileHandle? {
        let url = URL(fileURLWithPath: logDirectory()).appendingPathComponent(name)
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        guard let handle = try? FileHandle(forWritingTo: url) else { return nil }
        _ = try? handle.seekToEnd()
        return handle
    }

    private func isLocalServiceHealthy() -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/status") else { return false }
        let semaphore = DispatchSemaphore(value: 0)
        var healthy = false

        let task = URLSession.shared.dataTask(with: url) { data, response, error in
            if let http = response as? HTTPURLResponse, http.statusCode == 200, data != nil, error == nil {
                healthy = true
            }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 0.8)
        task.cancel()
        return healthy
    }

    private func portOwnerDescription() -> String? {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        process.arguments = ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN"]
        process.standardOutput = pipe
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return output.isEmpty ? nil : output
        } catch {
            return nil
        }
    }

    private func bundledResourceText(_ name: String) -> String? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "txt") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func escapeHtml(_ value: String) -> String {
        return value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}
