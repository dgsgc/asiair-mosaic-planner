// A small wrapper around the macOS accessibility API, enough to read and
// operate another app's window: find elements, press buttons, set text,
// and click where an element has no press action.

import AppKit
import ApplicationServices

public struct AXError: Error, CustomStringConvertible {
    public let description: String
    public init(_ d: String) { description = d }
}

public final class AXNode: CustomStringConvertible {
    public let element: AXUIElement
    public init(_ e: AXUIElement) { element = e }

    public func attr<T>(_ name: String) -> T? {
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &v) == .success else { return nil }
        return v as? T
    }

    public var role: String { attr(kAXRoleAttribute) ?? "" }
    public var subrole: String { attr(kAXSubroleAttribute) ?? "" }
    public var title: String { attr(kAXTitleAttribute) ?? "" }
    public var desc: String { attr(kAXDescriptionAttribute) ?? "" }
    public var identifier: String { attr("AXIdentifier") ?? "" }
    public var help: String { attr(kAXHelpAttribute) ?? "" }
    public var value: String {
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &v) == .success, let v else { return "" }
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return ""
    }
    /// Everything that could name this element, for matching.
    public var label: String {
        [title, desc, identifier, help].first { !$0.isEmpty } ?? ""
    }

    public var children: [AXNode] {
        (attr(kAXChildrenAttribute) as [AXUIElement]?)?.map(AXNode.init) ?? []
    }

    public var frame: CGRect {
        var p = CGPoint.zero, s = CGSize.zero
        if let pv: AXValue = attr(kAXPositionAttribute) { AXValueGetValue(pv, .cgPoint, &p) }
        if let sv: AXValue = attr(kAXSizeAttribute) { AXValueGetValue(sv, .cgSize, &s) }
        return CGRect(origin: p, size: s)
    }

    public var actions: [String] {
        var names: CFArray?
        guard AXUIElementCopyActionNames(element, &names) == .success, let n = names as? [String] else { return [] }
        return n
    }

    public var description: String {
        let f = frame
        var parts = [role]
        if !subrole.isEmpty { parts.append(subrole) }
        if !label.isEmpty { parts.append("\"\(label)\"") }
        let v = value
        if !v.isEmpty && v != label { parts.append("value=\"\(v.prefix(60))\"") }
        parts.append("[\(Int(f.minX)),\(Int(f.minY)) \(Int(f.width))×\(Int(f.height))]")
        let a = actions.filter { $0 != "AXScrollToVisible" && $0 != "AXShowMenu" }
        if !a.isEmpty { parts.append("{\(a.joined(separator: ","))}") }
        return parts.joined(separator: " ")
    }

    /// All descendants, depth first (this node first).
    public func all(maxDepth: Int = 40) -> [AXNode] {
        var out: [AXNode] = []
        func walk(_ n: AXNode, _ d: Int) {
            out.append(n)
            if d < maxDepth { for c in n.children { walk(c, d + 1) } }
        }
        walk(self, 0)
        return out
    }

    // ---- acting ------------------------------------------------------------

    /// Press through accessibility if the element supports it, otherwise click
    /// its centre with a real mouse click (the app must be in front).
    @discardableResult
    public func press() -> Bool {
        if actions.contains(kAXPressAction as String),
           AXUIElementPerformAction(element, kAXPressAction as CFString) == .success {
            return true
        }
        return click()
    }

    @discardableResult
    public func click() -> Bool {
        let f = frame
        guard f.width > 0, f.height > 0 else { return false }
        Mouse.click(at: CGPoint(x: f.midX, y: f.midY))
        return true
    }

    @discardableResult
    public func setValue(_ text: String) -> Bool {
        AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFString) == .success
    }

    public var isEnabledSwitchOn: Bool { value == "1" }
}

public enum Mouse {
    /// Runs before every real click or key press: brings the target app to
    /// the front so the event lands in it and nowhere else.
    public static var prepare: () -> Void = {}

    public static func click(at p: CGPoint) {
        prepare()
        // A plain click through the system's mouse stream. (Tested: this
        // closes the plan list and answers pop-ups; sending events straight
        // to the app instead does not.)
        let src = CGEventSource(stateID: .hidSystemState)
        CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(40_000)
        CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(60_000)
        CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    }
}

extension Mouse {
    /// Scroll sideways over a point (negative dx shows what is further right).
    public static func scroll(at p: CGPoint, dx: Int32) {
        prepare()
        let src = CGEventSource(stateID: .hidSystemState)
        CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(40_000)
        if let e = CGEvent(scrollWheelEvent2Source: src, units: .pixel, wheelCount: 2, wheel1: 0, wheel2: dx, wheel3: 0) {
            e.location = p
            e.post(tap: .cghidEventTap)
        }
    }
}

extension Mouse {
    public enum Route { case hid, session, app(pid_t) }

    /// The tap that opened the ASIAIR app's mode menu (18 Nov 2026): move
    /// through the system stream, then press, 1-point drag and release sent
    /// straight to the app, with no click-count marker.
    public static func appTap(at p: CGPoint, pid: pid_t) {
        prepare()
        let src = CGEventSource(stateID: .hidSystemState)
        CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(120_000)
        CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)?.postToPid(pid)
        usleep(80_000)
        let q = CGPoint(x: p.x + 1, y: p.y)
        CGEvent(mouseEventSource: src, mouseType: .leftMouseDragged, mouseCursorPosition: q, mouseButton: .left)?.postToPid(pid)
        usleep(80_000)
        CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: q, mouseButton: .left)?.postToPid(pid)
        usleep(100_000)
    }

    /// A tap with a chosen delivery route, press length and optional small
    /// drag, for controls that ignore the plain click.
    public static func tap(at p: CGPoint, route: Route, holdMs: Int = 80, drag: Bool = true) {
        prepare()
        let src = CGEventSource(stateID: .hidSystemState)
        func post(_ type: CGEventType, _ at: CGPoint) {
            guard let e = CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: at, mouseButton: .left) else { return }
            if type != .mouseMoved { e.setIntegerValueField(.mouseEventClickState, value: 1) }
            switch route {
            case .hid: e.post(tap: .cghidEventTap)
            case .session: e.post(tap: .cgSessionEventTap)
            case .app(let pid):
                if type == .mouseMoved { e.post(tap: .cghidEventTap) }
                e.postToPid(pid)
            }
        }
        post(.mouseMoved, p)
        usleep(100_000)
        post(.leftMouseDown, p)
        if drag {
            let steps = 4
            for i in 1...steps {
                usleep(useconds_t(holdMs * 1000 / steps))
                post(.leftMouseDragged, CGPoint(x: p.x + Double(i) * 0.5, y: p.y))
            }
            post(.leftMouseUp, CGPoint(x: p.x + 2, y: p.y))
        } else {
            usleep(useconds_t(holdMs * 1000))
            post(.leftMouseUp, p)
        }
    }
}

public enum Keyboard {
    /// Type plain text into whatever has keyboard focus.
    public static func type(_ text: String) {
        Mouse.prepare()
        let src = CGEventSource(stateID: .hidSystemState)
        for ch in text.utf16 {
            var c = ch
            let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true)
            down?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &c)
            down?.post(tap: .cghidEventTap)
            let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)
            up?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &c)
            up?.post(tap: .cghidEventTap)
            usleep(15_000)
        }
    }
}

/// The ASIAIR app as an accessibility target.
public final class ASIAIRApp {
    public static let bundleID = "com.ZWO.ASIAIR"
    public let running: NSRunningApplication
    public let app: AXNode

    public init() throws {
        guard AXIsProcessTrusted() else {
            throw AXError("This app needs Accessibility permission: System Settings → Privacy & Security → Accessibility.")
        }
        guard let r = NSRunningApplication.runningApplications(withBundleIdentifier: Self.bundleID).first else {
            throw AXError("The ASIAIR app isn't running. Open it and connect to your ASIAIR first.")
        }
        running = r
        app = AXNode(AXUIElementCreateApplication(r.processIdentifier))
        AXUIElementSetMessagingTimeout(app.element, 5)
        let r2 = r
        Mouse.prepare = {
            if !r2.isActive {
                r2.activate()
                for _ in 0..<20 where !r2.isActive { usleep(50_000) }
                usleep(250_000)
            }
        }
    }

    public func activate() {
        running.activate()
        usleep(300_000)
    }

    /// The ASIAIR window, or nil when it can't be reached (for example while
    /// the screen is locked or asleep, when macOS hides other apps' windows).
    public var window: AXNode? {
        var cands: [AXNode] = []
        if let w: AXUIElement = app.attr(kAXMainWindowAttribute) { cands.append(AXNode(w)) }
        cands += ((app.attr(kAXWindowsAttribute) as [AXUIElement]?) ?? []).map(AXNode.init)
        return cands.first { $0.role == "AXWindow" && $0.frame.width > 100 }
    }

    public func requireWindow() throws -> AXNode {
        guard let w = window else {
            throw AXError("Can't reach the ASIAIR window. Make sure the Mac's screen is on and unlocked, and the ASIAIR app's window is open (not minimised).")
        }
        return w
    }

    public func elements() -> [AXNode] { window?.all() ?? [] }
}
