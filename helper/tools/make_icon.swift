// Draws the app icons: a night-sky tile with a 2×2 mosaic of panel frames.
// The Plan Sender's icon adds a "send" badge.
//
//     swift tools/make_icon.swift      → Resources/PlannerIcon.icns, Resources/AppIcon.icns
//
// Writes .iconset folders in $TMPDIR and turns them into .icns with iconutil.

import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func color(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: a)
}

/// A repeatable pseudo-random sequence, so the stars are the same every build.
struct Seeded {
    var state: UInt64
    mutating func next() -> CGFloat {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return CGFloat((state >> 33) & 0xffffff) / CGFloat(0xffffff)
    }
}

/// Draws on a 1024-point canvas (y up), scaled to `size` pixels.
func draw(size: Int, badge: Bool) -> CGImage {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.scaleBy(x: CGFloat(size) / 1024, y: CGFloat(size) / 1024)
    ctx.interpolationQuality = .high

    // The tile: macOS icon grid, 824-point body with a soft shadow.
    let body = CGRect(x: 100, y: 100, width: 824, height: 824)
    let shape = CGPath(roundedRect: body, cornerWidth: 186, cornerHeight: 186, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: color(0x000000, 0.45))
    ctx.addPath(shape)
    ctx.setFillColor(color(0x070b1c))
    ctx.fillPath()
    ctx.restoreGState()

    ctx.saveGState()
    ctx.addPath(shape)
    ctx.clip()
    // Night sky: deep blue at the top to near black.
    let sky = CGGradient(colorsSpace: space, colors: [color(0x16244d), color(0x0a1230), color(0x04060f)] as CFArray, locations: [0, 0.55, 1])!
    ctx.drawLinearGradient(sky, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
    // A faint nebula behind the mosaic.
    func glow(_ c: CGPoint, _ r: CGFloat, _ hex: UInt32, _ a: CGFloat) {
        let g = CGGradient(colorsSpace: space, colors: [color(hex, a), color(hex, 0)] as CFArray, locations: [0, 1])!
        ctx.drawRadialGradient(g, startCenter: c, startRadius: 0, endCenter: c, endRadius: r, options: [])
    }
    glow(CGPoint(x: 470, y: 560), 360, 0xd0457a, 0.42)
    glow(CGPoint(x: 600, y: 440), 300, 0x3aa6c9, 0.30)
    glow(CGPoint(x: 520, y: 520), 150, 0xffd9a8, 0.22)
    // A galaxy in the middle, tilted, like M31: a soft disc and a bright core.
    ctx.saveGState()
    ctx.translateBy(x: 512, y: 512)
    ctx.rotate(by: 32 * .pi / 180)
    ctx.scaleBy(x: 1, y: 0.34)
    let halo = CGGradient(colorsSpace: space, colors: [color(0xa9bdf0, 0.38), color(0x6d86c8, 0)] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(halo, startCenter: .zero, startRadius: 0, endCenter: .zero, endRadius: 380, options: [])
    let disc = CGGradient(colorsSpace: space, colors: [color(0xfff4dd, 1), color(0xf6cf96, 0.75), color(0xc9b4c8, 0.35), color(0x8ea2dc, 0)] as CFArray,
                          locations: [0, 0.22, 0.6, 1])!
    ctx.drawRadialGradient(disc, startCenter: .zero, startRadius: 0, endCenter: .zero, endRadius: 300, options: [])
    ctx.restoreGState()
    glow(CGPoint(x: 512, y: 512), 70, 0xfffaf0, 0.9)
    // Stars.
    var rng = Seeded(state: 20261126)
    for _ in 0..<170 {
        let p = CGPoint(x: 100 + rng.next() * 824, y: 100 + rng.next() * 824)
        let big = rng.next()
        let r: CGFloat = big > 0.96 ? 5.5 : big > 0.85 ? 3.4 : 2.0
        ctx.setFillColor(color(0xffffff, 0.45 + 0.55 * rng.next()))
        ctx.fillEllipse(in: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
    }
    // Two bright stars with spikes.
    for (p, r) in [(CGPoint(x: 268, y: 760), 9.0), (CGPoint(x: 770, y: 262), 7.0)] as [(CGPoint, CGFloat)] {
        glow(p, r * 6, 0xbfd8ff, 0.55)
        ctx.setStrokeColor(color(0xe8f0ff, 0.85))
        ctx.setLineWidth(3)
        ctx.strokeLineSegments(between: [CGPoint(x: p.x - r * 4, y: p.y), CGPoint(x: p.x + r * 4, y: p.y),
                                         CGPoint(x: p.x, y: p.y - r * 4), CGPoint(x: p.x, y: p.y + r * 4)])
        ctx.setFillColor(color(0xffffff))
        ctx.fillEllipse(in: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
    }

    // The mosaic: 2×2 overlapping panel frames, turned a little, in gold.
    ctx.saveGState()
    ctx.translateBy(x: 512, y: 512)
    ctx.rotate(by: -14 * .pi / 180)
    let w: CGFloat = 250, h: CGFloat = 186, overlap: CGFloat = 36
    let stepX = w - overlap, stepY = h - overlap
    let gold = color(0xffcf4a)
    for row in 0..<2 {
        for col in 0..<2 {
            let r = CGRect(x: -stepX / 2 - w / 2 + CGFloat(col) * stepX, y: -stepY / 2 - h / 2 + CGFloat(row) * stepY, width: w, height: h)
            ctx.setFillColor(color(0xffcf4a, 0.04))
            ctx.fill(r)
            ctx.setStrokeColor(gold)
            ctx.setLineWidth(11)
            ctx.setLineJoin(.round)
            ctx.stroke(r)
        }
    }
    ctx.restoreGState()

    // A thin light rim.
    ctx.addPath(shape)
    ctx.setStrokeColor(color(0xffffff, 0.10))
    ctx.setLineWidth(4)
    ctx.strokePath()
    ctx.restoreGState()

    if badge {
        // Plan Sender: a blue round badge with a paper plane, bottom right.
        let c = CGPoint(x: 770, y: 254), r: CGFloat = 132
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -6), blur: 16, color: color(0x000000, 0.5))
        ctx.setFillColor(color(0x2f7ff0))
        ctx.fillEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
        ctx.restoreGState()
        ctx.setStrokeColor(color(0xffffff, 0.9))
        ctx.setLineWidth(8)
        ctx.strokeEllipse(in: CGRect(x: c.x - r + 4, y: c.y - r + 4, width: r * 2 - 8, height: r * 2 - 8))
        let plane = CGMutablePath()
        plane.move(to: CGPoint(x: c.x - 72, y: c.y - 6))
        plane.addLine(to: CGPoint(x: c.x + 74, y: c.y + 58))
        plane.addLine(to: CGPoint(x: c.x + 22, y: c.y - 72))
        plane.addLine(to: CGPoint(x: c.x - 2, y: c.y - 22))
        plane.closeSubpath()
        ctx.addPath(plane)
        ctx.setFillColor(color(0xffffff))
        ctx.fillPath()
        let fold = CGMutablePath()
        fold.move(to: CGPoint(x: c.x - 2, y: c.y - 22))
        fold.addLine(to: CGPoint(x: c.x + 74, y: c.y + 58))
        fold.addLine(to: CGPoint(x: c.x - 18, y: c.y - 50))
        fold.closeSubpath()
        ctx.addPath(fold)
        ctx.setFillColor(color(0xc9dcff))
        ctx.fillPath()
    }
    return ctx.makeImage()!
}

func writePNG(_ image: CGImage, _ url: URL) {
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    CGImageDestinationFinalize(dest)
}

let here = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().deletingLastPathComponent()
let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("asiair-icons")
try? FileManager.default.removeItem(at: tmp)
for (name, badge) in [("PlannerIcon", false), ("AppIcon", true)] {
    let set = tmp.appendingPathComponent("\(name).iconset")
    try FileManager.default.createDirectory(at: set, withIntermediateDirectories: true)
    for base in [16, 32, 128, 256, 512] {
        writePNG(draw(size: base, badge: badge), set.appendingPathComponent("icon_\(base)x\(base).png"))
        writePNG(draw(size: base * 2, badge: badge), set.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
    }
    writePNG(draw(size: 1024, badge: badge), tmp.appendingPathComponent("\(name)-1024.png"))
    let out = here.appendingPathComponent("Resources/\(name).icns")
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
    p.arguments = ["-c", "icns", set.path, "-o", out.path]
    try p.run()
    p.waitUntilExit()
    print("wrote \(out.path) (preview \(tmp.appendingPathComponent("\(name)-1024.png").path))")
}
