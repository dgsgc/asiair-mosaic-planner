// asiair-send: command-line front end of the ASIAIR Plan Sender.
//
//   asiair-send dump                 list every control the ASIAIR app shows (read-only)
//   asiair-send check FILE           read a send file and show what would be sent
//   asiair-send send FILE [--plan N] send the plans in FILE into the ASIAIR app

import AppKit
import ApplicationServices
import Foundation

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else {
    print("usage: asiair-send dump | check FILE | send FILE [--plan NAME]")
    exit(2)
}

do {
    switch cmd {
    case "dump":
        let a = try ASIAIRApp()
        let w = try a.requireWindow()
        func walk(_ n: AXNode, _ depth: Int) {
            print(String(repeating: "  ", count: depth) + n.description)
            if depth < 30 { for c in n.children { walk(c, depth + 1) } }
        }
        walk(w, 0)

    case "tap":  // tap X Y in window points (development aid)
        let a = try ASIAIRApp()
        guard args.count >= 3, let x = Double(args[1]), let y = Double(args[2]), let w = a.window?.frame else { fail("usage: asiair-send tap X Y") }
        a.activate()
        let p = CGPoint(x: w.minX + x, y: w.minY + y)
        print("before", NSEvent.mouseLocation, "tapping", p)
        // tap X Y [plain|hid|session|app] [holdMs] [nodrag]
        let style = args.count > 3 ? args[3] : "plain"
        let hold = args.count > 4 ? Int(args[4]) ?? 80 : 80
        let drag = !args.contains("nodrag")
        switch style {
        case "hid": Mouse.tap(at: p, route: .hid, holdMs: hold, drag: drag)
        case "session": Mouse.tap(at: p, route: .session, holdMs: hold, drag: drag)
        case "app": Mouse.tap(at: p, route: .app(a.running.processIdentifier), holdMs: hold, drag: drag)
        case "appold": Mouse.appTap(at: p, pid: a.running.processIdentifier)
        default: Mouse.click(at: p)
        }
        usleep(300_000)
        print("after", NSEvent.mouseLocation)

    case "plans":  // list the plans on the ASIAIR
        let sender = try Sender(log: { print($0) })
        sender.verbose = args.contains("--verbose")
        _ = try sender.air.requireWindow()
        sender.air.activate()
        try sender.ensurePlanPage()
        print(try sender.planNames())

    case "dumpall":  // every window and the app's own children (read-only)
        let a = try ASIAIRApp()
        func walk(_ n: AXNode, _ depth: Int) {
            print(String(repeating: "  ", count: depth) + n.description)
            for c in n.children { walk(c, depth + 1) }
        }
        let wins: [AXUIElement] = a.app.attr(kAXWindowsAttribute) ?? []
        print("windows: \(wins.count)")
        for w in wins { walk(AXNode(w), 0) }
        print("--- app children")
        for c in a.app.children { print(c.description) }
        if let f: AXUIElement = a.app.attr(kAXFocusedUIElementAttribute) { print("focused:", AXNode(f).description) }

    case "probe":  // development aid: evaluate a few lookups on the current screen
        let a = try ASIAIRApp()
        let els = a.elements()
        for l in args.dropFirst() {
            let hits = els.filter { $0.label == l }
            print("\(l): \(hits.count) \(hits.map { $0.role })")
        }

    case "delete-test-plans":  // development aid: remove plans named "Sender test …"
        let sender = try Sender(log: { print($0) })
        sender.verbose = args.contains("--verbose")
        sender.debugFolder = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        for name in try sender.planNames() where name.hasPrefix("Sender test ") {
            try sender.deletePlan(name)
        }

    case "dumpapp":  // development aid: list another app's window by bundle id
        guard args.count >= 2, let r = NSRunningApplication.runningApplications(withBundleIdentifier: args[1]).first else { fail("not running") }
        let app = AXNode(AXUIElementCreateApplication(r.processIdentifier))
        let wins: [AXUIElement] = app.attr(kAXWindowsAttribute) ?? []
        func walk(_ n: AXNode, _ depth: Int) {
            print(String(repeating: "  ", count: depth) + n.description)
            if depth < 30 { for c in n.children { walk(c, depth + 1) } }
        }
        for w in wins { walk(AXNode(w), 0) }

    case "mode":  // switch the main screen's mode (Preview, Plan, …)
        guard args.count >= 2 else { fail("usage: asiair-send mode NAME") }
        let sender = try Sender(log: { print($0) })
        sender.verbose = args.contains("--verbose")
        _ = try sender.air.requireWindow()
        sender.air.activate()
        try sender.switchMode(to: args[1])
        print("now in \(args[1]) mode")

    case "check":
        guard args.count >= 2 else { fail("usage: asiair-send check FILE") }
        let file = try PlanFile.load(URL(fileURLWithPath: args[1]))
        for p in file.plans { print(p.summary) }

    case "send":
        guard args.count >= 2 else { fail("usage: asiair-send send FILE [--plan NAME]") }
        var file = try PlanFile.load(URL(fileURLWithPath: args[1]))
        if let i = args.firstIndex(of: "--plan"), i + 1 < args.count {
            file.plans = file.plans.filter { $0.name == args[i + 1] }
            if file.plans.isEmpty { fail("No plan called \(args[i + 1]) in the file.") }
        }
        let sender = try Sender(log: { print($0) })
        sender.debugFolder = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        sender.verbose = args.contains("--verbose")
        try sender.send(file.plans)

    default:
        fail("unknown command \(cmd)")
    }
} catch {
    fail("Error: \(error)")
}
