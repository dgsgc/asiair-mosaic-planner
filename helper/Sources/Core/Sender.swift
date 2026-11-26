// Drives the ASIAIR app for Mac to create plans, the way a person would:
// new plan → Import the panels → exposure lines on the first panel →
// "Apply to all importing targets" → next plan.
//
// It only ever presses controls it has found by name (or, for the unnamed
// plan-page and plan-list buttons, by their exact place next to a named one),
// and checks the screen after every step. It never starts a plan, never
// touches the shutter, and stops at the first surprise.

import AppKit
import Foundation
import IOKit.pwr_mgt

/// Keeps the display awake while held.
final class ScreenAwake {
    var id: IOPMAssertionID = 0
    var held = false
    init(_ reason: String) {
        held = IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString,
                                           IOPMAssertionLevel(kIOPMAssertionLevelOn), reason as CFString, &id) == kIOReturnSuccess
    }
    func release() { if held { IOPMAssertionRelease(id); held = false } }
}

public final class Sender {
    public let air: ASIAIRApp
    let log: (String) -> Void
    public var stopRequested = false
    public var verbose = false
    func debug(_ m: String) { if verbose { log("· " + m) } }
    /// Where to write the app's control list if a step fails (for bug reports).
    public var debugFolder: URL?

    static let modes = ["Preview", "Live", "Plan", "Autorun", "Focus", "PA", "Video"]

    public init(log: @escaping (String) -> Void) throws {
        air = try ASIAIRApp()
        self.log = log
    }

    // ---- looking at the screen ----------------------------------------------

    var els: [AXNode] { air.elements() }
    var win: CGRect { air.window?.frame ?? .zero }

    func node(_ label: String, role: String? = nil, in list: [AXNode]? = nil) -> AXNode? {
        (list ?? els).first { $0.label == label && (role == nil || $0.role == role) }
    }

    func nodes(_ label: String, role: String? = nil) -> [AXNode] {
        els.filter { $0.label == label && (role == nil || $0.role == role) }
    }

    /// Position inside the window (the app lays itself out in window units).
    func local(_ n: AXNode) -> CGRect {
        n.frame.offsetBy(dx: -win.minX, dy: -win.minY)
    }

    var onPlanPage: Bool { node("Import", role: "AXButton") != nil && node("Share", role: "AXButton") != nil }

    func pause(_ s: Double) { usleep(useconds_t(s * 1_000_000)) }

    func checkStop() throws {
        if stopRequested { throw AXError("Stopped.") }
    }

    /// Wait for something to appear on screen.
    @discardableResult
    func wait(_ what: String, timeout: Double = 8, _ find: () -> AXNode?) throws -> AXNode {
        let end = Date().addingTimeInterval(timeout)
        repeat {
            try checkStop()
            if let n = find() { return n }
            pause(0.25)
        } while Date() < end
        throw failure("Timed out waiting for \(what).")
    }

    func waitGone(_ what: String, timeout: Double = 6, _ find: () -> AXNode?) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        repeat {
            if find() == nil { return true }
            pause(0.25)
        } while Date() < end
        return false
    }

    /// Make an error, and save the screen's control list for diagnosis.
    func failure(_ message: String) -> AXError {
        if let dir = debugFolder, let w = air.window {
            var lines: [String] = []
            func walk(_ n: AXNode, _ d: Int) {
                lines.append(String(repeating: "  ", count: d) + n.description)
                for c in n.children { walk(c, d + 1) }
            }
            walk(w, 0)
            let f = dir.appendingPathComponent("plan-sender-debug-\(Int(Date().timeIntervalSince1970)).txt")
            try? (message + "\n\n" + lines.joined(separator: "\n")).write(to: f, atomically: true, encoding: .utf8)
        }
        return AXError(message + " If the ASIAIR app is showing a message, close it and try again.")
    }

    // ---- the app's pop-ups ----------------------------------------------------
    // The ASIAIR app's pop-ups are invisible to accessibility. Each has a
    // fixed layout, centred in the window, Cancel on the left and the main
    // button on the right. A tap outside a pop-up dismisses it, so only the
    // measured button spot is tapped (in window points of the 1051×816
    // window, scaled if the window is another size). A just-shown pop-up can
    // ignore its first tap, so the same spot is tried a few times, and only
    // while `still` holds; it stops as soon as `done` does.

    enum Popup {
        /// "Apply Sequence and Settings — Apply current sequence and settings
        /// to all importing targets" (Cancel / Apply).
        case applyToAll
        /// "Are you sure to delete this Plan?" (Cancel / Delete).
        case deletePlan
        var buttonY: Double { self == .applyToAll ? 470 : 448 }
    }

    func answerPopup(_ popup: Popup, main: Bool, still: () -> Bool, done: () -> Bool) -> Bool {
        pause(0.8)
        let p = CGPoint(x: win.minX + win.width * ((main ? 584.0 : 468.0) / 1051),
                        y: win.minY + win.height * (popup.buttonY / 816))
        for attempt in 1...3 {
            if done() { return true }
            guard still() else { return done() }
            debug("tapping the pop-up's \(main ? "main" : "Cancel") button at \(p) (try \(attempt))")
            Mouse.click(at: p)
            let end = Date().addingTimeInterval(1.5)
            while Date() < end {
                if done() { return true }
                pause(0.2)
            }
        }
        return done()
    }

    var onTargetPage: Bool { node("plan copy", role: "AXButton") != nil && node("Import", role: "AXButton") == nil }

    // ---- getting to the plan page --------------------------------------------

    public func ensurePlanPage() throws {
        if onPlanPage { return }
        if let cancel = node("Cancel", role: "AXButton"), node("Bin1", role: "AXButton") != nil {
            log("Closing an open exposure dialog…")
            cancel.press()
            pause(0.8)
        }
        // A target's page inside a plan: go back to the plan page. If the
        // app offers to apply this target's exposures to the others, decline,
        // so nothing in the user's plan changes.
        if node("plan copy", role: "AXButton") != nil, let back = node("back left", role: "AXButton") {
            log("Leaving the open target…")
            back.press()
            if (try? wait("the plan page", timeout: 2) { onPlanPage ? air.window : nil }) != nil { return }
            // Still here: the "apply to all importing targets" pop-up is up.
            // Answer Cancel so the user's plan isn't changed.
            guard answerPopup(.applyToAll, main: false, still: { onTargetPage }, done: { onPlanPage }) else {
                throw failure("Couldn't get back to the plan page.")
            }
            return
        }
        // The main screen: the mode button on the right is named after the
        // current mode ("Preview", "Plan", …).
        guard let mode = els.first(where: { $0.role == "AXButton" && Self.modes.contains($0.label) && local($0).minX > win.width * 0.8 }) else {
            throw failure("Couldn't find the ASIAIR app's main screen or plan page. Open the app's main screen (or its plan page) and try again.")
        }
        if mode.label != "Plan" {
            log("Switching the ASIAIR app from \(mode.label) to Plan mode…")
            try switchMode(to: "Plan")
        }
        guard let modeNow = els.first(where: { $0.role == "AXButton" && $0.label == "Plan" && local($0).minX > win.width * 0.8 }) else {
            throw failure("The ASIAIR app didn't switch to Plan mode.")
        }
        // The plan-page button: the unnamed 33-point button just below the
        // mode label. (The round shutter button further down is 36 points
        // and is never pressed.)
        let m = modeNow.frame
        guard let planButton = els.first(where: {
            $0.role == "AXButton" && $0.label.isEmpty
                && abs($0.frame.midX - m.midX) < 20
                && $0.frame.minY > m.maxY && $0.frame.minY < m.maxY + 50
                && abs($0.frame.width - 33) < 4 && abs($0.frame.height - 33) < 4
        }) else {
            throw failure("Couldn't find the plan button under the Plan mode label.")
        }
        log("Opening the plan page…")
        planButton.press()
        try wait("the plan page") { onPlanPage ? node("Import", role: "AXButton") : nil }
    }

    var modeButton: AXNode? {
        els.first { $0.role == "AXButton" && Self.modes.contains($0.label) && local($0).minX > win.width * 0.8 }
    }

    /// Switch the main screen's mode. Its menu (and the items in it) respond
    /// to real taps only, and not every time, so each tap is checked and
    /// repeated.
    public func switchMode(to target: String) throws {
        guard Self.modes.contains(target) else { throw AXError("Unknown mode \(target).") }
        for round in 1...3 {
            guard let mode = modeButton else { throw failure("Couldn't find the mode button on the ASIAIR app's main screen.") }
            if mode.label == target { return }
            var item = node(target, role: "AXStaticText")
            for attempt in 1...4 where item == nil {
                mode.click()
                debug("tapped the mode button (round \(round), try \(attempt))")
                item = try? wait("the mode menu", timeout: 1.5) { node(target, role: "AXStaticText") }
            }
            guard let item else { continue }
            for attempt in 1...4 {
                guard node(target, role: "AXStaticText") != nil else { break }
                item.click()
                debug("tapped \(target) in the mode menu (try \(attempt))")
                pause(1.2)
            }
            if (try? wait("\(target) mode", timeout: 3) { modeButton?.label == target ? modeButton : nil }) != nil { return }
        }
        throw failure("The ASIAIR app didn't switch to \(target) mode. Switch it by hand and try again.")
    }

    // ---- the plan list ---------------------------------------------------------

    /// The two small unnamed buttons at the top right of the plan page:
    /// [plan settings, plan list].
    func topRightButtons() -> [AXNode] {
        els.filter { $0.role == "AXButton" && $0.label.isEmpty && local($0).minY < 50 && local($0).minX > win.width * 0.85 && $0.frame.width < 25 }
            .sorted { $0.frame.minX < $1.frame.minX }
    }

    var listOpen: Bool { node("choose object menu add", role: "AXButton") != nil }

    func openList() throws {
        if listOpen { return }
        guard let b = topRightButtons().last else { throw failure("Couldn't find the plan list button.") }
        b.press()
        try wait("the plan list") { node("choose object menu add", role: "AXButton") }
    }

    func closeList() throws {
        // Tap an empty part of the page, left of the list. Right after the
        // list changes the app can ignore a tap, so allow a few.
        for attempt in 1...4 {
            guard listOpen else { return }
            pause(attempt == 1 ? 0.6 : 1.0)
            let p = CGPoint(x: win.minX + win.width * 0.45, y: win.minY + win.height * 0.5)
            debug("closing the plan list (try \(attempt)): tap at \(p), front app \(NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "?")")
            Mouse.click(at: p)
            if waitGone("the plan list to close", timeout: 1.5, { node("choose object menu add", role: "AXButton") }) { return }
        }
        throw failure("The plan list didn't close.")
    }

    /// Names of the plans on the ASIAIR (list rows read "Name, targets").
    public func planNames() throws -> [String] {
        try openList()
        pause(0.4)
        let names = els.compactMap { n -> String? in
            guard n.role == "AXStaticText", local(n).minX > win.width * 0.7, local(n).minY > 50 else { return nil }
            let l = n.label
            guard let comma = l.range(of: ", ", options: .backwards), Int(l[comma.upperBound...]) != nil else { return nil }
            return String(l[..<comma.lowerBound])
        }
        try closeList()
        return names
    }

    var currentPlanTitle: String? {
        els.first { $0.role == "AXStaticText" && local($0).minY < 50 && abs($0.frame.midX - win.midX) < 120 && !$0.label.isEmpty }?.label
    }

    // ---- one plan --------------------------------------------------------------

    func createPlan(_ name: String) throws {
        log("Creating plan “\(name)”…")
        try openList()
        node("choose object menu add", role: "AXButton")!.press()
        try wait("the new plan form") { node("Auto Guiding") }
        guard let field = els.filter({ $0.role == "AXTextField" && local($0).minX > win.width * 0.6 })
            .min(by: { $0.frame.minY < $1.frame.minY }) else {
            throw failure("Couldn't find the Plan Name box.")
        }
        field.setValue(name)
        pause(0.3)
        guard let confirm = node("Confirm", role: "AXButton") else { throw failure("Couldn't find Confirm.") }
        confirm.press()
        try wait("the new plan to open") { currentPlanTitle == name ? air.window : nil }
        try closeList()
    }

    func importTargets(_ text: String, first: String, count: Int) throws {
        log("Importing \(count) target\(count == 1 ? "" : "s")…")
        guard let imp = nodes("Import", role: "AXButton").first(where: { local($0).minY > win.height * 0.9 }) else {
            throw failure("Couldn't find Import.")
        }
        var areaFound: AXNode?
        for attempt in 1...3 {
            pause(attempt == 1 ? 0.6 : 0.8)
            imp.press()
            debug("pressed Import (try \(attempt))")
            areaFound = try? wait("the Import box", timeout: 2.5) { els.first { $0.role == "AXTextArea" } }
            if areaFound != nil { break }
        }
        guard let area = areaFound else { throw failure("The Import box didn't open.") }
        // The box only takes text once it has been tapped and typed into.
        if !area.setValue(text) || area.value != text {
            area.press()
            pause(0.3)
            Keyboard.type("N")
            pause(0.3)
            guard let a2 = els.first(where: { $0.role == "AXTextArea" }), a2.setValue(text) else {
                throw failure("Couldn't put the targets into the Import box.")
            }
        }
        pause(0.3)
        guard let ok = nodes("Import", role: "AXButton").first(where: { $0.frame.height > 25 }) else {
            throw failure("Couldn't find the Import box's Import button.")
        }
        ok.press()
        // The app opens the first imported target.
        try wait("the first target to open", timeout: 15) {
            if els.contains(where: { $0.label.localizedCaseInsensitiveContains("format incorrect") }) {
                return nil
            }
            return node("plan copy", role: "AXButton")
        }
        guard currentPlanTitle == first else {
            throw failure("Expected the target “\(first)” to open, found “\(currentPlanTitle ?? "nothing")”.")
        }
    }

    /// Exposure lines on the open target, as the texts their cards show.
    func cards() -> [Set<String>] {
        els.filter { g in g.role == "AXGroup" && g.children.contains { $0.label == "newplan delete target" } }
            .map { Set($0.children.map(\.label).filter { !$0.isEmpty }) }
    }

    func cardTexts(_ e: Exposure) -> Set<String> {
        [e.type, Exposure.fmt(e.exposure) + "s", "0/\(e.count)", e.gain.map { "Gain \($0)" } ?? "Default Gain", "Bin\(e.bin)"]
    }

    func addExposure(_ e: Exposure) throws {
        log("  adding \(e.summary)")
        let want = cardTexts(e)
        func matching() -> Int { cards().filter { want.isSubset(of: $0) }.count }
        let before = matching()
        // The "+" tile: an unnamed tile just right of the target's info column.
        guard let tile = els.first(where: {
            $0.label.isEmpty && ($0.role == "AXStaticText" || $0.role == "AXButton")
                && local($0).minX > 120 && local($0).minX < 320 && local($0).minY < 120
                && $0.frame.width > 60 && $0.frame.height > 50
        }) else {
            throw failure("Couldn't find the add-exposure tile.")
        }
        // A page that has only just opened can ignore the first press.
        var opened = false
        for attempt in 1...3 {
            pause(attempt == 1 ? 0.8 : 0.5)
            if attempt < 3 { tile.press() } else { tile.click() }
            debug("pressed the add-exposure tile (try \(attempt))")
            if (try? wait("the exposure dialog", timeout: 2.5) { node("Bin1", role: "AXButton") }) != nil { opened = true; break }
        }
        guard opened else { throw failure("The exposure dialog didn't open.") }
        pause(0.5)
        // Type and binning first: the app applies a type change a moment
        // later and resets the other boxes when it does.
        node(e.type, role: "AXButton")?.press()
        pause(0.6)
        guard let bin = node("Bin\(e.bin)", role: "AXButton") else { throw failure("Couldn't find Bin\(e.bin).") }
        bin.press()
        pause(0.6)
        let wantValues = [Exposure.fmt(e.exposure), e.gain.map(String.init) ?? "Default Gain", String(e.count)]
        func boxes() -> [AXNode] {
            els.filter { $0.role == "AXTextField" && local($0).minX > win.width * 0.35 && local($0).minX < win.width * 0.65 }
                .sorted { $0.frame.minY < $1.frame.minY }
        }
        var filled = false
        for attempt in 1...3 {
            let f = boxes()
            guard f.count >= 3 else { throw failure("The exposure dialog's boxes weren't found.") }
            for (box, v) in zip(f.prefix(3), wantValues) where box.value != v {
                box.setValue(v)
                pause(0.3)
            }
            pause(0.4)
            let now = boxes().prefix(3).map(\.value)
            debug("dialog boxes (try \(attempt)): \(now)")
            if now == wantValues { filled = true; break }
        }
        guard filled else { throw failure("The exposure dialog didn't take the values \(wantValues).") }
        // The first OK sometimes only closes the app's number keypad.
        for _ in 0..<3 {
            guard let ok = node("OK", role: "AXButton") else { break }
            ok.press()
            if waitGone("the exposure dialog", timeout: 1.5, { node("Bin1", role: "AXButton") }) { break }
        }
        do {
            try wait("the exposure line to appear", timeout: 20) { matching() > before ? air.window : nil }
        } catch {
            let shown = cards().last.map { $0.sorted().joined(separator: " ") } ?? "nothing"
            throw failure("The new exposure line doesn't match \(e.summary) (the app shows: \(shown)).")
        }
    }

    /// Open one imported target from the plan page by its name, scrolling the
    /// row of targets to the right if it isn't in view yet.
    func cardTitle(_ name: String) throws -> AXNode {
        for attempt in 0..<12 {
            if let title = els.first(where: { $0.role == "AXStaticText" && $0.label == name && local($0).minY < win.height * 0.3 }) {
                return title
            }
            // Not in view: scroll the targets sideways and look again.
            let p = CGPoint(x: win.minX + win.width * 0.5, y: win.minY + win.height * 0.5)
            Mouse.scroll(at: p, dx: -300)
            pause(attempt == 0 ? 0.6 : 0.4)
        }
        throw failure("Couldn't find the target “\(name)” on the plan page.")
    }

    func openTarget(_ name: String) throws {
        log("  opening \(name)")
        let t = try cardTitle(name)
        // Its Detail button sits at the bottom of the same card.
        guard let detail = nodes("Detail", role: "AXButton")
            .filter({ $0.frame.minX >= t.frame.minX - 30 && $0.frame.minX < t.frame.maxX })
            .min(by: { abs($0.frame.minX - t.frame.minX) < abs($1.frame.minX - t.frame.minX) }) else {
            throw failure("Couldn't find the Detail button for “\(name)”.")
        }
        for attempt in 1...3 {
            pause(attempt == 1 ? 0.4 : 0.8)
            detail.press()
            if (try? wait("“\(name)” to open", timeout: 3) { currentPlanTitle == name && onTargetPage ? air.window : nil }) != nil { return }
        }
        throw failure("The target “\(name)” didn't open.")
    }

    /// The plan page's "Target done/ticked" line, e.g. "Target 0/2".
    var tickedCount: Int? {
        for n in els where n.role == "AXStaticText" && n.label.hasPrefix("Target ") {
            let parts = n.label.dropFirst("Target ".count).split(separator: "/")
            if parts.count == 2, let ticked = Int(parts[1].trimmingCharacters(in: .whitespaces)) { return ticked }
        }
        return nil
    }

    /// Targets whose exposures were added by hand are left unticked (left out
    /// of the plan) by the app. Tick each one that is off, checking the
    /// plan's ticked count after every press and undoing a press that
    /// lowered it, so no tick is ever left changed the wrong way.
    func tickAll(_ names: [String]) throws {
        guard onPlanPage else { throw failure("Expected the plan page.") }
        guard var count = tickedCount else { throw failure("Couldn't read the plan's target count.") }
        for name in names where count < names.count {
            try checkStop()
            let title = try cardTitle(name)
            guard let tick = nodes("newplan unselected target", role: "AXButton")
                .filter({ $0.frame.maxX <= title.frame.minX + 4 && $0.frame.minX > title.frame.minX - 40 })
                .first else { throw failure("Couldn't find the tick for “\(name)”.") }
            tick.press()
            pause(0.7)
            var now = tickedCount ?? count
            if now == count {  // the press didn't register: tap it instead
                tick.click()
                pause(0.7)
                now = tickedCount ?? count
            }
            if now < count {  // it was ticked already: put it back
                let lowered = now
                tick.press()
                pause(0.7)
                now = tickedCount ?? lowered
                if now == lowered {
                    tick.click()
                    pause(0.7)
                    now = tickedCount ?? lowered
                }
                if now < count { throw failure("Couldn't put back the tick on “\(name)”. Tick it again in the ASIAIR app.") }
            } else if now > count {
                log("  ticked \(name)")
            }
            count = now
        }
        guard count >= names.count else {
            throw failure("Only \(count) of \(names.count) targets are ticked. Tick the others in the ASIAIR app.")
        }
    }

    func finishTarget(applyToAll: Bool) throws {
        guard let back = node("back left", role: "AXButton") else { throw failure("Couldn't find the back button.") }
        back.press()
        if (try? wait("the plan page", timeout: 2.5) { onPlanPage ? air.window : nil }) != nil {
            if applyToAll { throw failure("The ASIAIR app didn't offer to apply the exposures to the other targets.") }
            return
        }
        // "Apply Sequence and Settings — Apply current sequence and settings
        // to all importing targets": Apply copies this target's exposures to
        // every imported target; Cancel leaves them empty.
        log(applyToAll ? "  applying the exposures to every panel" : "  leaving the target")
        guard answerPopup(.applyToAll, main: applyToAll, still: { onTargetPage }, done: { onPlanPage }) else {
            throw failure("The ASIAIR app's “Apply to all” question couldn't be answered.")
        }
    }

    /// Delete one plan by name (used to clean up test plans). Opens it from
    /// the list, then plan settings → Delete Plan → Delete.
    public func deletePlan(_ name: String) throws {
        _ = try air.requireWindow()
        air.activate()
        try ensurePlanPage()
        try openList()
        pause(0.4)
        guard let row = els.first(where: { $0.role == "AXStaticText" && $0.label.hasPrefix(name + ", ") && local($0).minX > win.width * 0.7 }) else {
            try closeList()
            throw AXError("No plan called “\(name)”.")
        }
        row.click()   // list rows only open with a real tap
        try wait("“\(name)” to open") { currentPlanTitle == name ? air.window : nil }
        try closeList()
        // Plan settings is the button just left of the plan-list button.
        // (A plan with targets also shows a third, progress-reset button
        // further left, which is never pressed.)
        let tops = topRightButtons()
        guard tops.count >= 2 else { throw failure("Couldn't find the plan settings button.") }
        let settings = tops[tops.count - 2]
        var delFound: AXNode?
        for attempt in 1...3 {
            pause(attempt == 1 ? 0.6 : 0.8)
            settings.press()
            debug("pressed plan settings (try \(attempt))")
            delFound = try? wait("Delete Plan", timeout: 2.5) { node("Delete Plan", role: "AXButton") }
            if delFound != nil { break }
        }
        guard let del = delFound else { throw failure("Plan settings didn't open.") }
        del.press()
        // "Are you sure to delete this Plan?" — Delete is the main button.
        guard answerPopup(.deletePlan, main: true, still: { currentPlanTitle == name }, done: { currentPlanTitle != name }) else {
            throw failure("Couldn't confirm deleting “\(name)”.")
        }
        // Close the settings panel if it is still showing.
        if node("Delete Plan", role: "AXButton") != nil {
            Mouse.click(at: CGPoint(x: win.minX + win.width * 0.45, y: win.minY + win.height * 0.5))
            pause(0.6)
        }
        log("Deleted “\(name)”.")
    }

    public func send(_ plans: [Plan]) throws {
        _ = try air.requireWindow()
        // Keep the screen awake while sending: a sleeping or locked screen
        // hides the ASIAIR window from accessibility.
        let awake = ScreenAwake("Sending plans to the ASIAIR app")
        defer { awake.release() }
        air.activate()
        try ensurePlanPage()
        let existing = Set(try planNames())
        let clash = plans.map(\.name).filter(existing.contains)
        if !clash.isEmpty {
            throw AXError("The ASIAIR already has a plan called \(clash.map { "“\($0)”" }.joined(separator: ", ")). Rename or delete it in the ASIAIR app first.")
        }
        for plan in plans {
            try checkStop()
            air.activate()
            try createPlan(plan.name)
            try importTargets(plan.importText, first: plan.targets[0].name, count: plan.targets.count)
            for e in plan.exposures {
                try checkStop()
                try addExposure(e)
            }
            // The app's "apply to all importing targets" copies every setting
            // of the exposure lines except the gain (seen 26 Nov 2026: the
            // other panels got "Default Gain"). So when a line has a gain,
            // decline it and add the lines to each panel in turn instead.
            let many = plan.targets.count > 1 && !plan.exposures.isEmpty
            let byHand = many && plan.exposures.contains { $0.gain != nil }
            try finishTarget(applyToAll: many && !byHand)
            if byHand {
                for target in plan.targets.dropFirst() {
                    try checkStop()
                    try openTarget(target.name)
                    for e in plan.exposures {
                        try checkStop()
                        try addExposure(e)
                    }
                    try finishTarget(applyToAll: false)
                }
                try tickAll(plan.targets.map(\.name))
            }
            log("✓ “\(plan.name)” is on the ASIAIR (\(plan.targets.count) target\(plan.targets.count == 1 ? "" : "s"), \(plan.exposures.count) exposure line\(plan.exposures.count == 1 ? "" : "s")).")
        }
        log("Done. Nothing has been started; check the plans in the ASIAIR app.")
    }
}
