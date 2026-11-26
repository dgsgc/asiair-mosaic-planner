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
