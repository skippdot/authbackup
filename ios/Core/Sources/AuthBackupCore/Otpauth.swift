/// otpauth:// links (Google's Key Uri Format) and what a QR or the clipboard may hold. Port of extension/lib/otpauth.js.
///
///     otpauth://totp/Issuer:account?secret=BASE32&issuer=Issuer&algorithm=SHA1&digits=6&period=30
public enum Otpauth {
    public static func parse(_ uri: String) throws(CoreError) -> OtpAccount {
        let url = try WebURL.parse(JS.trim(uri))
        guard url.scheme == "otpauth" else { throw .notOtpauth }
        let typeName = JS.lowercase(url.hostname)
        guard let type = OtpType(rawValue: typeName) else { throw .unknownType(typeName) }

        let secret = Base32.normalize(url.queryParam("secret") ?? "")
        guard Base32.isValid(secret) else { throw .noSecret }

        // Label = "Issuer:account" or just "account"; the colon may be encoded as %3A. The issuer parameter, when present,
        // is matched as the prefix first, so an issuer that itself contains ":" does not leak into the account name.
        var label = url.pathname
        if label.hasPrefix("/") { label.removeFirst() }
        label = try JS.decodeURIComponent(label)
        let issuerParam = url.queryParam("issuer") ?? ""
        var labelIssuer = ""
        var account = label
        if !issuerParam.isEmpty, label.hasPrefix(issuerParam + ":") {
            labelIssuer = issuerParam
            account = String(label.dropFirst(issuerParam.count + 1))
        } else if let colon = label.firstIndex(of: ":") {
            labelIssuer = String(label[..<colon])
            account = String(label[label.index(after: colon)...])
        }

        let algorithmName = (url.queryParam("algorithm") ?? "").nonEmpty(or: "SHA1").uppercased().replacingFirst("-", with: "")
        guard let algorithm = OtpAlgorithm(rawValue: algorithmName) else { throw .algorithm(algorithmName) }
        let digitsText = (url.queryParam("digits") ?? "").nonEmpty(or: "6")
        guard let digits = JS.parseInt(digitsText), [6.0, 7.0, 8.0].contains(digits) else { throw .digits(digitsText) }
        let periodText = (url.queryParam("period") ?? "").nonEmpty(or: "30")
        // The extension accepts any positive period; past Int32 it is not a period anyone uses, so it is refused here.
        guard let period = JS.parseInt(periodText), period > 0, period <= Double(Int32.max) else { throw .period(periodText) }
        var counter = 0.0
        if type == .hotp {
            let counterText = (url.queryParam("counter") ?? "").nonEmpty(or: "0")
            guard let value = JS.parseInt(counterText), JS.isSafeNonNegativeInteger(value) else { throw .counter(counterText) }
            counter = value
        }

        let issuer = JS.trim(issuerParam)
        return OtpAccount(type: type, issuer: issuer.isEmpty ? JS.trim(labelIssuer) : issuer, account: JS.trim(account),
                          secret: secret, algorithm: algorithm, digits: Int(digits), period: Int(period), counter: Int(counter))
    }

    public static func build(_ a: OtpAccount) -> String {
        let label = JS.encodeURIComponent(a.issuer.isEmpty ? a.account : "\(a.issuer):\(a.account)")
        var query = [("secret", a.secret)]
        if !a.issuer.isEmpty { query.append(("issuer", a.issuer)) }
        query.append(("algorithm", a.algorithm.rawValue))
        query.append(("digits", String(a.digits)))
        if a.type == .hotp { query.append(("counter", String(a.counter))) } else { query.append(("period", String(a.period))) }
        let search = query.map { "\(JS.formEncode($0.0))=\(JS.formEncode($0.1))" }.joined(separator: "&")
        return "otpauth://\(a.type.rawValue)/\(label)?\(search)"
    }

    public enum Parsed: Sendable, Equatable {
        case otpauth(OtpAccount)
        case migration(Migration.Result)
    }

    /// What a QR or the clipboard holds: an otpauth:// link or a Google Authenticator export.
    public static func parseAny(_ text: String) throws(CoreError) -> Parsed {
        let t = JS.trim(text)
        if t.lowercased().hasPrefix("otpauth-migration:") { return .migration(try Migration.parse(t)) }
        if t.lowercased().hasPrefix("otpauth:") { return .otpauth(try parse(t)) }
        throw .notOtp
    }
}

extension String {
    func nonEmpty(or fallback: String) -> String { isEmpty ? fallback : self }

    func replacingFirst(_ target: String, with replacement: String) -> String {
        guard let range = range(of: target) else { return self }
        return replacingCharacters(in: range, with: replacement)
    }
}
