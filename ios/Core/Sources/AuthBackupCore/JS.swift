import Foundation

/// The few JavaScript built-ins whose exact behavior the extension's parsers depend on. Reproducing them (rather than
/// using Foundation's nearest equivalents) is what makes a link or a backup read the same in the browser and on the phone.
enum JS {
    /// WhiteSpace and LineTerminator of ECMAScript: what String.prototype.trim(), parseInt() and `\s` skip.
    static func isWhitespace(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
        default: false
        }
    }

    /// String.prototype.trim().
    static func trim(_ s: String) -> String {
        let scalars = s.unicodeScalars
        guard let start = scalars.firstIndex(where: { !isWhitespace($0) }),
              let end = scalars.lastIndex(where: { !isWhitespace($0) }) else { return "" }
        return String(scalars[start...end])
    }

    /// `s.replace(/\s/g, '')`.
    static func removingWhitespace(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        out.append(contentsOf: s.unicodeScalars.filter { !isWhitespace($0) })
        return String(out)
    }

    /// parseInt(s, 10) as a JS Number; nil stands for NaN. "6abc" is 6, " +8" is 8, "1.5" is 1, "abc" is NaN.
    static func parseInt(_ s: String) -> Double? {
        var scalars = Substring(s).unicodeScalars.drop(while: isWhitespace)
        var sign = 1.0
        if let first = scalars.first, first == "-" || first == "+" {
            if first == "-" { sign = -1 }
            scalars = scalars.dropFirst()
        }
        var digits = String.UnicodeScalarView()
        digits.append(contentsOf: scalars.prefix(while: { $0.value >= 0x30 && $0.value <= 0x39 }))
        guard !digits.isEmpty, let value = Double(String(digits)) else { return nil }
        return sign * value
    }

    /// Number.isSafeInteger(x) && x >= 0.
    static func isSafeNonNegativeInteger(_ x: Double) -> Bool {
        x >= 0 && x <= 9_007_199_254_740_991 && x.rounded(.towardZero) == x
    }

    /// String(x) for a JS Number: integers without ".0", the shortest round-trip form otherwise.
    static func numberToString(_ x: Double) -> String {
        if x.isNaN { return "NaN" }
        if x.isInfinite { return x < 0 ? "-Infinity" : "Infinity" }
        if x == 0 { return "0" }
        if x.rounded(.towardZero) == x, abs(x) < 1e21 {
            if abs(x) <= 9_007_199_254_740_991 { return String(Int64(x)) }
            return String(format: "%.0f", x)
        }
        let text = "\(x)" // Swift also prints the shortest round-trip digits
        return text.replacingOccurrences(of: "e-0", with: "e-").replacingOccurrences(of: "e+0", with: "e+")
    }

    /// String.prototype.toLowerCase(): Unicode default case mapping, including the context-sensitive final sigma
    /// ("ΣΑΣ" → "σας"), which a per-character mapping would get wrong.
    static func lowercase(_ s: String) -> String {
        let scalars = Array(s.unicodeScalars)
        guard scalars.contains("\u{03A3}") else { return s.lowercased() }
        var out = ""
        for (i, scalar) in scalars.enumerated() {
            if scalar == "\u{03A3}", isFinalSigma(scalars, at: i) {
                out.unicodeScalars.append("\u{03C2}")
            } else {
                out += String(scalar).lowercased()
            }
        }
        return out
    }

    /// Unicode Final_Sigma: preceded by a cased letter and not followed by one (case-ignorable characters skipped).
    private static func isFinalSigma(_ s: [Unicode.Scalar], at i: Int) -> Bool {
        var j = i - 1
        while j >= 0, s[j].properties.isCaseIgnorable { j -= 1 }
        guard j >= 0, s[j].properties.isCased else { return false }
        var k = i + 1
        while k < s.count, s[k].properties.isCaseIgnorable { k += 1 }
        return !(k < s.count && s[k].properties.isCased)
    }

    // MARK: - Percent-encoding

    private static func isAlnum(_ b: UInt8) -> Bool {
        (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A)
    }

    private static let hexDigits = Array("0123456789ABCDEF".utf8)

    private static func appendEscaped(_ b: UInt8, to out: inout [UInt8]) {
        out += [0x25, hexDigits[Int(b >> 4)], hexDigits[Int(b & 0x0F)]]
    }

    /// encodeURIComponent(): everything but A-Z a-z 0-9 - _ . ! ~ * ' ( ) is %-escaped as UTF-8.
    static func encodeURIComponent(_ s: String) -> String {
        let unreserved = Set("-_.!~*'()".utf8)
        var out: [UInt8] = []
        for b in s.utf8 {
            if isAlnum(b) || unreserved.contains(b) { out.append(b) } else { appendEscaped(b, to: &out) }
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// The application/x-www-form-urlencoded serializer of URLSearchParams: space → "+", only * - . _ and alphanumerics kept.
    static func formEncode(_ s: String) -> String {
        let kept = Set("*-._".utf8)
        var out: [UInt8] = []
        for b in s.utf8 {
            if b == 0x20 { out.append(0x2B) } else if isAlnum(b) || kept.contains(b) { out.append(b) } else { appendEscaped(b, to: &out) }
        }
        return String(decoding: out, as: UTF8.self)
    }

    private static func hexValue(_ b: UInt8) -> UInt8? {
        switch b {
        case 0x30...0x39: b - 0x30
        case 0x41...0x46: b - 0x41 + 10
        case 0x61...0x66: b - 0x61 + 10
        default: nil
        }
    }

    /// The URL Standard's percent-decode: a "%" that does not start a valid escape is kept as it is.
    static func percentDecode(_ bytes: [UInt8]) -> [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(bytes.count)
        var i = 0
        while i < bytes.count {
            if bytes[i] == 0x25, i + 2 < bytes.count, let hi = hexValue(bytes[i + 1]), let lo = hexValue(bytes[i + 2]) {
                out.append(hi << 4 | lo)
                i += 3
            } else {
                out.append(bytes[i])
                i += 1
            }
        }
        return out
    }

    /// decodeURIComponent(): a broken escape or an escape that is not valid UTF-8 is an error (URIError in JS).
    static func decodeURIComponent(_ s: String) throws(CoreError) -> String {
        let bytes = Array(s.utf8)
        var out: [UInt8] = []
        var i = 0
        while i < bytes.count {
            if bytes[i] == 0x25 {
                guard i + 2 < bytes.count, let hi = hexValue(bytes[i + 1]), let lo = hexValue(bytes[i + 2]) else {
                    throw .malformed("URI malformed")
                }
                out.append(hi << 4 | lo)
                i += 3
            } else {
                out.append(bytes[i])
                i += 1
            }
        }
        guard let text = String(validating: out, as: UTF8.self) else { throw .malformed("URI malformed") }
        return text
    }

    /// new URLSearchParams(query): "&"-separated pairs, "+" read as a space, lenient %-decoding, invalid UTF-8 → U+FFFD.
    static func formParams(_ query: String) -> [(name: String, value: String)] {
        Array(query.utf8).split(separator: 0x26).map { part in
            let bytes = Array(part)
            let eq = bytes.firstIndex(of: 0x3D)
            let name = eq.map { Array(bytes[..<$0]) } ?? bytes
            let value = eq.map { Array(bytes[($0 + 1)...]) } ?? []
            return (formDecode(name), formDecode(value))
        }
    }

    private static func formDecode(_ bytes: [UInt8]) -> String {
        String(decoding: percentDecode(bytes.map { $0 == 0x2B ? 0x20 : $0 }), as: UTF8.self)
    }

    // MARK: - Base64 (atob / btoa)

    private static let base64Alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".utf8)
    private static let base64Index: [UInt8: UInt8] = Dictionary(uniqueKeysWithValues: base64Alphabet.enumerated().map { ($1, UInt8($0)) })

    /// base64ToBytes() of extension/lib/base32.js: URL-safe letters mapped back, whitespace dropped, padding restored, then
    /// atob()'s forgiving-base64 decode (leftover bits are discarded, a stray "=" or character is an error).
    static func base64ToBytes(_ input: String) throws(CoreError) -> [UInt8] {
        var s = Array(removingWhitespace(input.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")).utf8)
        while s.count % 4 != 0 { s.append(0x3D) }
        if s.count % 4 == 0 {
            if s.last == 0x3D { s.removeLast(); if s.last == 0x3D { s.removeLast() } }
        }
        guard s.count % 4 != 1 else { throw .malformed("invalid base64") }
        var out: [UInt8] = []
        var buffer: UInt32 = 0, bits = 0
        for c in s {
            guard let v = base64Index[c] else { throw .malformed("invalid base64") }
            buffer = buffer << 6 | UInt32(v)
            bits += 6
            if bits >= 8 {
                bits -= 8
                out.append(UInt8(truncatingIfNeeded: buffer >> UInt32(bits)))
            }
        }
        return out
    }

    /// btoa() over bytes: standard alphabet with "=" padding.
    static func bytesToBase64(_ bytes: [UInt8]) -> String {
        Data(bytes).base64EncodedString()
    }
}
