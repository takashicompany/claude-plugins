import Cocoa

// htmlreveal:///abs/path を受け取り、Finder でそのファイルを選択表示するだけの受け口。
// ファイルを開いたり実行したりはしない。存在しないパスは無視する。
final class AppDelegate: NSObject, NSApplicationDelegate {
    var handled = false
    func applicationWillFinishLaunching(_ n: Notification) {
        NSAppleEventManager.shared().setEventHandler(self, andSelector: #selector(handleURL(_:reply:)),
            forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
    }
    func applicationDidFinishLaunching(_ n: Notification) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { if !self.handled { NSApp.terminate(nil) } }
    }
    @objc func handleURL(_ e: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        handled = true
        defer { DispatchQueue.main.async { NSApp.terminate(nil) } }
        guard let s = e.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
              let u = URL(string: s), u.scheme == "htmlreveal" else { return }
        let path = URL(fileURLWithPath: u.path).standardizedFileURL.path
        guard path.hasPrefix("/"), FileManager.default.fileExists(atPath: path) else { return }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }
}
let app = NSApplication.shared
let d = AppDelegate(); app.delegate = d
app.setActivationPolicy(.prohibited)
app.run()
