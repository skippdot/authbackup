/// RFC 4648 Base32 (alphabet A-Z2-7), the form TOTP keys come in. Port of extension/lib/base32.js.
public enum Base32 {
    private static let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".utf8)

    /// Human input as a key: upper case, without whitespace, hyphens and "=" padding.
    public static func normalize(_ input: String) -> String {
        var out = String.UnicodeScalarView()
        out.append(contentsOf: input.uppercased().unicodeScalars.filter { !JS.isWhitespace($0) && $0 != "-" && $0 != "=" })
        return String(out)
    }

    private static func isAlphabet(_ s: String) -> Bool {
        s.utf8.allSatisfy { ($0 >= 0x41 && $0 <= 0x5A) || ($0 >= 0x32 && $0 <= 0x37) } && s.unicodeScalars.allSatisfy(\.isASCII)
    }

    /// At least two characters: one is 5 bits, less than a byte, and HMAC needs a non-empty key.
    public static func isValid(_ input: String) -> Bool {
        let s = normalize(input)
        return s.utf16.count >= 2 && isAlphabet(s)
    }

    public static func decode(_ input: String) throws(CoreError) -> [UInt8] {
        let s = normalize(input)
        guard isAlphabet(s) else { throw .base32Chars }
        var out: [UInt8] = []
        out.reserveCapacity(s.utf8.count * 5 / 8)
        var value: UInt32 = 0, bits = 0
        for c in s.utf8 {
            let index = UInt32(alphabet.firstIndex(of: c)!)
            value = value << 5 | index
            bits += 5
            if bits >= 8 {
                out.append(UInt8(truncatingIfNeeded: value >> UInt32(bits - 8)))
                bits -= 8
            }
        }
        return out
    }

    /// Without "=" padding, as keys are written in otpauth:// links.
    public static func encode(_ bytes: [UInt8]) -> String {
        var out: [UInt8] = []
        var value: UInt32 = 0, bits = 0
        for b in bytes {
            value = value << 8 | UInt32(b)
            bits += 8
            while bits >= 5 {
                out.append(alphabet[Int((value >> UInt32(bits - 5)) & 31)])
                bits -= 5
            }
        }
        if bits > 0 { out.append(alphabet[Int((value << UInt32(5 - bits)) & 31)]) }
        return String(decoding: out, as: UTF8.self)
    }
}
