/// How a key is shown, the same way as in the extension's popup (extension/lib/ui.js).
public extension OtpAccount {
    /// The issuer, else the account; nil when the key has neither (the app shows "No name").
    var title: String? { issuer.isEmpty ? (account.isEmpty ? nil : account) : issuer }

    /// The account under the issuer; empty when the title already is the account.
    var subtitle: String { issuer.isEmpty ? "" : account }

    /// Non-standard parameters, shown as badges so a person can see the QR code was read correctly.
    var badges: [Badge] {
        var out: [Badge] = []
        if type == .hotp { out.append(.hotp) }
        if algorithm != .sha1 { out.append(.algorithm(algorithm.rawValue)) }
        if digits != 6 { out.append(.digits(digits)) }
        if type == .totp, period != 30 { out.append(.period(period)) }
        return out
    }

    enum Badge: Hashable, Sendable {
        case hotp, algorithm(String), digits(Int), period(Int)
    }
}

public enum Display {
    /// "482913" → "482 913", "1234567" → "123 4567", as in the extension.
    public static func group(_ code: String) -> String {
        guard !code.isEmpty else { return "" }
        let half = code.count / 2
        return "\(code.prefix(half)) \(code.dropFirst(half))"
    }
}
