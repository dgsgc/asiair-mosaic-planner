// ASIAIR Plan Sender: a small window that takes a send file from the
// ASIAIR Mosaic Planner and enters its plans into the ASIAIR app for Mac.

import AppKit
import ApplicationServices
import SwiftUI
import UniformTypeIdentifiers

@main
struct PlanSenderApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var model = Model.shared

    var body: some Scene {
        Window("ASIAIR Plan Sender", id: "main") {
            ContentView()
                .environmentObject(model)
                .frame(minWidth: 520, minHeight: 600)
        }
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Open Send File…") { model.chooseFile() }
                    .keyboardShortcut("o")
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func application(_ application: NSApplication, open urls: [URL]) {
        if let url = urls.first { Task { @MainActor in Model.shared.load(url) } }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@MainActor
final class Model: ObservableObject {
    static let shared = Model()

    @Published var fileURL: URL?
    @Published var plans: [Plan] = []
    @Published var chosen: Set<String> = []
    @Published var log: [String] = []
    @Published var running = false
    @Published var trusted = AXIsProcessTrusted()
    @Published var asiairRunning = false
    @Published var error: String?

    private var sender: Sender?
    private var timer: Timer?

    init() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { _ in
            Task { @MainActor in self.refresh() }
        }
        refresh()
    }

    func refresh() {
        trusted = AXIsProcessTrusted()
        asiairRunning = !NSRunningApplication.runningApplications(withBundleIdentifier: ASIAIRApp.bundleID).isEmpty
    }

    func askForPermission() {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(opts)
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    func chooseFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "asiairplan") ?? .json, .json]
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url { load(url) }
    }

    func load(_ url: URL) {
        error = nil
        do {
            let f = try PlanFile.load(url)
            fileURL = url
            plans = f.plans
            chosen = Set(f.plans.map(\.name))
            log = []
        } catch {
            self.error = "\(error)"
        }
    }

    var canSend: Bool { trusted && asiairRunning && !running && !chosen.isEmpty }

    func send() {
        let todo = plans.filter { chosen.contains($0.name) }
        guard !todo.isEmpty else { return }
        running = true
        error = nil
        log = ["Sending \(todo.count) plan\(todo.count == 1 ? "" : "s"). Don't use the mouse or keyboard until it has finished."]
        Thread.detachNewThread { [weak self] in
            var problem: String?
            do {
                let s = try Sender(log: { line in Task { @MainActor in self?.log.append(line) } })
                s.debugFolder = FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask).first
                Task { @MainActor in self?.sender = s }
                try s.send(todo)
            } catch {
                problem = "\(error)"
            }
            Task { @MainActor in
                guard let self else { return }
                self.running = false
                self.sender = nil
                if let problem {
                    self.error = problem
                    self.log.append("Stopped: \(problem)")
                }
                NSApp.activate(ignoringOtherApps: true)
            }
        }
    }

    func stop() {
        sender?.stopRequested = true
        log.append("Stopping after the current step…")
    }
}

struct ContentView: View {
    @EnvironmentObject var model: Model
    @State private var dropping = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Enters plans from the ASIAIR Mosaic Planner into the ASIAIR app, exposures included. Each plan becomes its own ASIAIR plan; nothing is started.")
                .font(.callout).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if !model.trusted {
                Banner(symbol: "lock.shield", tint: .orange,
                       text: "Plan Sender needs permission to operate the ASIAIR app. Allow it under Privacy & Security → Accessibility, then come back.") {
                    Button("Open Settings") { model.askForPermission() }
                }
            }
            if !model.asiairRunning {
                Banner(symbol: "exclamationmark.triangle", tint: .yellow,
                       text: "Open the ASIAIR app and connect it to the ASIAIR you want the plans on.") { EmptyView() }
            }

            fileArea

            if !model.plans.isEmpty {
                List {
                    ForEach(model.plans, id: \.name) { p in
                        Toggle(isOn: Binding(
                            get: { model.chosen.contains(p.name) },
                            set: { on in if on { model.chosen.insert(p.name) } else { model.chosen.remove(p.name) } }
                        )) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).font(.headline)
                                Text(p.summary.split(separator: "\n").dropFirst().joined(separator: " · "))
                                    .font(.caption).foregroundStyle(.secondary)
                                Text("\(p.targets.count) target\(p.targets.count == 1 ? "" : "s")")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        .disabled(model.running)
                    }
                }
                .frame(minHeight: 120)
            }

            HStack {
                Button {
                    model.send()
                } label: {
                    Label("Send to ASIAIR", systemImage: "paperplane.fill").frame(minWidth: 140)
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!model.canSend)
                if model.running {
                    Button("Stop", role: .cancel) { model.stop() }
                    ProgressView().controlSize(.small)
                }
                Spacer()
                Text("Leave the mouse alone while it works.").font(.caption).foregroundStyle(.secondary)
            }

            if let e = model.error {
                Text(e).foregroundStyle(.red).font(.callout).fixedSize(horizontal: false, vertical: true)
            }

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(model.log.enumerated()), id: \.offset) { i, line in
                            Text(line).font(.system(.caption, design: .monospaced)).id(i)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(8)
                }
                .background(Color(nsColor: .textBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(nsColor: .separatorColor)))
                .onChange(of: model.log.count) { n in proxy.scrollTo(n - 1) }
            }
            .frame(minHeight: 120)
        }
        .padding(18)
    }

    var fileArea: some View {
        HStack(spacing: 12) {
            Image(systemName: "doc.badge.plus").font(.title2).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(model.fileURL?.lastPathComponent ?? "Drop a send file here")
                    .font(.headline)
                Text("Save one from the planner: “Send file: this target” or “all for rig”.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Open…") { model.chooseFile() }.disabled(model.running)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 8).strokeBorder(dropping ? Color.accentColor : Color(nsColor: .separatorColor),
                                                                    style: StrokeStyle(lineWidth: 1.5, dash: [5])))
        .onDrop(of: [.fileURL], isTargeted: $dropping) { items in
            guard let item = items.first else { return false }
            _ = item.loadObject(ofClass: URL.self) { url, _ in
                if let url { Task { @MainActor in model.load(url) } }
            }
            return true
        }
    }
}

struct Banner<Extra: View>: View {
    let symbol: String
    let tint: Color
    let text: String
    @ViewBuilder let extra: () -> Extra

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(tint)
            Text(text).font(.callout).fixedSize(horizontal: false, vertical: true)
            Spacer()
            extra()
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(tint.opacity(0.12)))
    }
}
