// ASIAIR Mosaic Planner for Mac: the planner web page, bundled inside the app,
// with the Plan Sender built in. The page is the same code as the online
// planner; inside the app it asks the app (window.webkit.messageHandlers.host)
// to save files, copy text, send plans to the ASIAIR app and post plans to a
// Star Adventurer controller.

import AppKit
import ApplicationServices
import SwiftUI
import UniformTypeIdentifiers
import WebKit

@main
struct PlannerApp: App {
    @NSApplicationDelegateAdaptor(PlannerDelegate.self) var delegate
    @StateObject private var model = Model.shared

    var body: some Scene {
        Window("ASIAIR Mosaic Planner", id: "planner") {
            PlannerView()
                .frame(minWidth: 900, minHeight: 600)
        }
        .defaultSize(width: 1440, height: 900)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Open Plan File…") { Bridge.shared.run("document.getElementById('import-plan')?.click()") }
                    .keyboardShortcut("o")
            }
            CommandGroup(replacing: .saveItem) {
                Button("Save Plan File…") { Bridge.shared.run("document.getElementById('export-plan')?.click()") }
                    .keyboardShortcut("s")
            }
            CommandGroup(after: .toolbar) {
                Button("Reload Page") { Bridge.shared.webView?.reload() }
                    .keyboardShortcut("r")
            }
        }
    }
}

final class PlannerDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

// MARK: - The bundled page, served as planner://localhost/…

/// Serves the planner's files from the app's Resources/planner folder. A
/// custom scheme (not file://) lets the page load its modules and keep its
/// storage, like any web page.
final class PlannerFiles: NSObject, WKURLSchemeHandler {
    static let scheme = "planner"
    let root = Bundle.main.resourceURL!.appendingPathComponent("planner", isDirectory: true)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])!)
            task.didFinish()
            return
        }
        let types = ["html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css",
                     "json": "application/json", "svg": "image/svg+xml", "png": "image/png", "ico": "image/x-icon"]
        let type = types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                        headerFields: ["Content-Type": "\(type); charset=utf-8", "Cache-Control": "no-cache"])!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

// MARK: - What the page asks the app to do

@MainActor
final class Bridge: NSObject, WKScriptMessageHandlerWithReply, WKUIDelegate, WKNavigationDelegate {
    static let shared = Bridge()
    weak var webView: WKWebView?
    var openSendWindow: (() -> Void)?

    func run(_ js: String) { webView?.evaluateJavaScript(js) }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(nil, "bad message")
            return
        }
        switch op {
        case "save":
            // A Save dialog for a file the page made.
            let name = body["name"] as? String ?? "plan.txt"
            let text = body["text"] as? String ?? ""
            let panel = NSSavePanel()
            panel.nameFieldStringValue = name
            panel.canCreateDirectories = true
            if let window = webView?.window {
                panel.beginSheetModal(for: window) { response in
                    guard response == .OK, let url = panel.url else { return replyHandler(false, nil) }
                    do {
                        try text.write(to: url, atomically: true, encoding: .utf8)
                        replyHandler(url.lastPathComponent, nil)
                    } catch {
                        replyHandler(nil, error.localizedDescription)
                    }
                }
            } else {
                replyHandler(nil, "no window")
            }

        case "copy":
            let text = body["text"] as? String ?? ""
            NSPasteboard.general.clearContents()
            replyHandler(NSPasteboard.general.setString(text, forType: .string), nil)

        case "asiair":
            // Plans for the ASIAIR app: open the Send window with them.
            let text = body["file"] as? String ?? ""
            let title = body["title"] as? String ?? "From the planner"
            Model.shared.load(Data(text.utf8), from: title)
            openSendWindow?()
            replyHandler(Model.shared.running ? "busy" : (Model.shared.error == nil ? "ok" : Model.shared.error), nil)

        case "post":
            // A plan for a Star Adventurer controller on the local network.
            guard let s = body["url"] as? String, let url = URL(string: s), ["http", "https"].contains(url.scheme ?? "") else {
                return replyHandler(nil, "bad address")
            }
            var req = URLRequest(url: url, timeoutInterval: 8)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = Data((body["body"] as? String ?? "").utf8)
            URLSession.shared.dataTask(with: req) { data, response, error in
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                let timedOut = (error as? URLError)?.code == .timedOut
                Task { @MainActor in
                    if let error {
                        replyHandler(["ok": false, "timeout": timedOut, "error": error.localizedDescription], nil)
                    } else {
                        replyHandler(["ok": true, "status": status, "text": text], nil)
                    }
                }
            }.resume()

        default:
            replyHandler(nil, "unknown op \(op)")
        }
    }

    // alert() and confirm() as Mac dialogs.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    // <input type="file"> (Open).
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = [.json]
        if let window = webView.window {
            panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
        } else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
    }

    // Links that leave the planner (target=_blank or other sites) open in the browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, navigationAction.targetFrame?.isMainFrame == true,
           url.scheme != PlannerFiles.scheme, url.scheme != "about", url.scheme != "blob" {
            NSWorkspace.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }
}

// MARK: - The window

struct PlannerView: View {
    @ObservedObject private var model = Model.shared
    @State private var sending = false

    var body: some View {
        WebView()
            .onAppear { Bridge.shared.openSendWindow = { sending = true } }
            // Send to ASIAIR slides down over the planner.
            .sheet(isPresented: $sending) {
                ContentView(onClose: { sending = false }).tint(.plannerTeal)
                    .environmentObject(model)
                    .frame(width: 600, height: 620)
            }
    }
}

struct WebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(PlannerFiles(), forURLScheme: PlannerFiles.scheme)
        // --seed plan.json (with --check): a throwaway store holding that plan,
        // for the guide's screenshots. The app's own data is never touched.
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--seed"), i + 1 < args.count,
           let seed = try? String(contentsOfFile: args[i + 1], encoding: .utf8) {
            config.websiteDataStore = .nonPersistent()
            let js = "localStorage.setItem('asiair-mosaic-planner.v1', \(String(reflecting: seed)));"
            config.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        } else {
            config.websiteDataStore = .default()
        }
        config.userContentController.addScriptMessageHandler(Bridge.shared, contentWorld: .page, name: "host")
        let web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = Bridge.shared
        web.navigationDelegate = Bridge.shared
        web.allowsMagnification = true
        if #available(macOS 13.3, *) { web.isInspectable = true }
        Bridge.shared.webView = web
        web.load(URLRequest(url: URL(string: "\(PlannerFiles.scheme)://localhost/index.html")!))
        if let i = CommandLine.arguments.firstIndex(of: "--check") {
            let next = i + 1 < CommandLine.arguments.count ? CommandLine.arguments[i + 1] : nil
            let out = next?.hasPrefix("-") == false ? next : nil
            SelfCheck.run(web, picture: out)
        }
        return web
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

// MARK: - Self-check (development aid)

/// `ASIAIR Mosaic Planner --check [picture.png]`: loads the planner, waits,
/// prints what works (sky view, storage, data files, app bridge) as JSON,
/// saves a picture of the page and quits. Changes nothing.
enum SelfCheck {
    static func option(_ name: String) -> String? {
        let a = CommandLine.arguments
        guard let i = a.firstIndex(of: name), i + 1 < a.count else { return nil }
        return a[i + 1]
    }

    static func run(_ web: WKWebView, picture: String?) {
        // --size 1440x900: the window's content size.
        if let s = option("--size")?.split(separator: "x").compactMap({ Double($0) }), s.count == 2 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { web.window?.setContentSize(NSSize(width: s[0], height: s[1])) }
        }
        // --js "…": run on the page once it has loaded (scroll, open a card…).
        if let js = option("--js") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { web.evaluateJavaScript(js) }
        }
        let wait = Double(option("--wait") ?? "") ?? 12
        DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
            let js = """
              const r = {};
              r.title = document.title;
              r.accessibility = \(AXIsProcessTrusted());
              r.inApp = document.documentElement.classList.contains('in-app');
              r.webgl2 = !!document.createElement('canvas').getContext('webgl2');
              r.skyCanvas = !!document.querySelector('#aladin canvas');
              const se = document.querySelector('#sky-error'); r.skyError = se && !se.hidden ? se.textContent : null;
              try { localStorage.setItem('__check', '1'); r.storage = localStorage.getItem('__check') === '1'; localStorage.removeItem('__check'); } catch (e) { r.storage = String(e); }
              r.savedState = !!localStorage.getItem('asiair-mosaic-planner.v1');
              r.rigs = document.querySelectorAll('#rig-list li').length;
              r.names = (await fetch('data/names.json').then((x) => x.json()).catch(() => null))?.names?.length ?? null;
              r.suggestions = document.querySelectorAll('#name-suggestions option').length;
              r.sesame = await fetch('https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oI/SNV?M31').then((x) => x.text()).then((x) => x.includes('%J')).catch((e) => String(e));
              r.sendHeading = document.querySelector('#send-asiair h3')?.textContent;
              if (\(CommandLine.arguments.contains("--check-send"))) {
                const file = { format: 'asiair-plan-sender', version: 1, plans: [{ name: 'Check plan', importText: 'Name,RA,DEC,Angle\\nCheck_1-1,00h 42m 44s,+41° 16′ 09″,', targets: [{ name: 'Check_1-1', ra: 10.68, dec: 41.27 }], exposures: [{ type: 'Light', exposure: 60, gain: 100, count: 1, bin: 1 }] }] };
                r.sendWindow = await window.webkit.messageHandlers.host.postMessage({ op: 'asiair', file: JSON.stringify(file), title: 'Check plan' });
              }
              return JSON.stringify(r);
            """
            web.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
                switch result {
                case .success(let v):
                    let text = v as? String ?? "\(String(describing: v))"
                    print(text)
                    // Also next to the picture, for runs started with `open`.
                    if let picture { try? text.write(toFile: picture + ".json", atomically: true, encoding: .utf8) }
                case .failure(let e): print("check failed: \(e)")
                }
                guard let picture else { exit(0) }
                web.takeSnapshot(with: nil) { image, _ in
                    if let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                       let png = rep.representation(using: .png, properties: [:]) {
                        try? png.write(to: URL(fileURLWithPath: picture))
                    }
                    // --send-picture out.png: press the page's Send to ASIAIR
                    // (this target) and picture the Send panel. Nothing is sent.
                    guard let sendPicture = option("--send-picture") else { exit(0) }
                    web.evaluateJavaScript("document.getElementById('send-target').click()")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                        // The app's own window, as the screen shows it.
                        if let sheet = web.window?.attachedSheet,
                           let image = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(sheet.windowNumber), [.boundsIgnoreFraming, .bestResolution]) {
                            try? NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: sendPicture))
                        }
                        exit(0)
                    }
                }
            }
        }
    }
}
