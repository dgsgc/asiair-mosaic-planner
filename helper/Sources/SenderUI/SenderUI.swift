// The Send window shared by ASIAIR Plan Sender and the ASIAIR Mosaic Planner
// app: the plans to send, permission and ASIAIR-app checks, Send, and a log.

import AppKit
import ApplicationServices
import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class Model: ObservableObject {
    static let shared = Model()

    @Published var fileURL: URL?
    /// Where the plans came from when there is no file ("From the planner").
    @Published var sourceName: String?
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

    /// Plans handed over by the planner app.
    func load(_ data: Data, from source: String) {
        guard !running else { return }
        error = nil
        do {
            let f = try PlanFile.load(data, name: source)
            fileURL = nil
            sourceName = source
            plans = f.plans
            chosen = Set(f.plans.map(\.name))
            log = []
        } catch {
            self.error = "\(error)"
        }
    }

    func load(_ url: URL) {
        error = nil
        do {
            let f = try PlanFile.load(url)
            fileURL = url
            sourceName = nil
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

/// This app's name, for messages ("ASIAIR Plan Sender" or "ASIAIR Mosaic Planner").
let appName = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "This app"

extension Color {
    /// The planner's own colour in the tools' shared design (teal #3bb3a1).
    static let plannerTeal = Color(red: 59 / 255, green: 179 / 255, blue: 161 / 255)
}

struct ContentView: View {
    @EnvironmentObject var model: Model
    @State private var dropping = false
    /// Set when shown as a sheet in the planner app: adds a heading and Done,
    /// and the plans come from the planner rather than a file.
    var onClose: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let onClose {
                HStack {
                    Text("Send to ASIAIR").font(.title2.bold())
                    Spacer()
                    Button("Done") { onClose() }
                        .keyboardShortcut(.cancelAction)
                        .disabled(model.running)
                }
            }
            Text(onClose != nil
                 ? "Enters these plans into the ASIAIR app for Mac, exposures included. Each target becomes its own ASIAIR plan; nothing is started."
                 : "Enters plans from the ASIAIR Mosaic Planner into the ASIAIR app, exposures included. Each plan becomes its own ASIAIR plan; nothing is started.")
                .font(.callout).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if !model.trusted {
                Banner(symbol: "lock.shield", tint: .orange,
                       text: "\(appName) needs permission to operate the ASIAIR app. Allow it under Privacy & Security → Accessibility (if it is already listed and switched on, remove it with − and add it again with +), then come back.") {
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
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxWidth: .infinity)
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
                Text(model.sourceName ?? model.fileURL?.lastPathComponent ?? "Drop a send file here")
                    .font(.headline)
                Text(model.sourceName != nil ? "Check the plans below, then press Send to ASIAIR." : "Save one from the planner: “Send file: this target” or “all for rig”.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if onClose == nil {
                Button("Open…") { model.chooseFile() }.disabled(model.running)
            }
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
