// The send file the planner saves (".asiairplan", JSON).

import Foundation

public struct Exposure: Codable, Equatable, Sendable {
    public var type: String      // Light, Dark, Flat, Bias
    public var exposure: Double  // seconds
    public var gain: Int?        // nil = the app's "Default Gain"
    public var count: Int
    public var bin: Int          // 1...4

    public var summary: String {
        let g = gain.map { "gain \($0)" } ?? "default gain"
        return "\(type) \(Self.fmt(exposure)) s × \(count), \(g), bin \(bin)"
    }
    static func fmt(_ x: Double) -> String {
        x == x.rounded() ? String(Int(x)) : String(x)
    }
}

public struct PlanTarget: Codable, Equatable, Sendable {
    public var name: String
    public var ra: Double
    public var dec: Double
}

public struct Plan: Codable, Equatable, Sendable {
    public var name: String
    public var importText: String
    public var targets: [PlanTarget]
    public var exposures: [Exposure]

    public var seconds: Double { exposures.reduce(0) { $0 + $1.exposure * Double($1.count) } * Double(targets.count) }

    public var summary: String {
        let h = Int(seconds) / 3600, m = (Int(seconds) % 3600) / 60
        var s = "\(name): \(targets.count) target\(targets.count == 1 ? "" : "s"), \(h)h \(m)m"
        for e in exposures { s += "\n  " + e.summary }
        if exposures.isEmpty { s += "\n  (no exposures)" }
        return s
    }
}

public struct PlanFile: Codable, Sendable {
    public var format: String
    public var version: Int
    public var plans: [Plan]

    public static func load(_ url: URL) throws -> PlanFile {
        try load(Data(contentsOf: url), name: url.lastPathComponent)
    }

    public static func load(_ data: Data, name: String) throws -> PlanFile {
        let f = try JSONDecoder().decode(PlanFile.self, from: data)
        guard f.format == "asiair-plan-sender" else { throw AXError("\(name) isn't a Plan Sender file.") }
        guard f.version == 1 else { throw AXError("\(name) was made by a newer planner (version \(f.version)).") }
        for p in f.plans {
            guard !p.targets.isEmpty, p.importText.hasPrefix("Name,RA,DEC,Angle") else {
                throw AXError("Plan \(p.name) in \(name) has no targets.")
            }
            for e in p.exposures {
                guard ["Light", "Dark", "Flat", "Bias"].contains(e.type), (1...4).contains(e.bin),
                      e.exposure > 0, e.count > 0 else {
                    throw AXError("Plan \(p.name) has an exposure line the ASIAIR can't take: \(e.summary)")
                }
            }
        }
        return f
    }
}
