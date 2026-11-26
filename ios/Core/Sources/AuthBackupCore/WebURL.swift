/// The part of the WHATWG URL parser (what `new URL()` does in the browser) that otpauth:// and otpauth-migration://
/// links reach: non-special schemes, an opaque host, a path with dot segments, a query. Foundation's URL follows
/// RFC 3986 instead and disagrees on exactly the links people paste: unescaped spaces, "+" in the query, "../".
struct WebURL: Sendable {
    /// Lower-case scheme without ":" (url.protocol minus the colon).
    let scheme: String
    /// url.hostname: "" when the link has no "//" authority or an empty one.
    let hostname: String
    /// url.pathname with dot segments resolved, escapes left as written ("/Example:alice").
    let pathname: String
    /// url.search without "?", escapes left as written.
    let query: String

    private static let special: Set<String> = ["http", "https", "ws", "wss", "ftp", "file"]

    static func parse(_ input: String) throws(CoreError) -> WebURL {
        // Leading and trailing C0 controls and spaces are stripped, tabs and newlines removed anywhere.
        var scalars = Array(input.unicodeScalars)
        while let first = scalars.first, first.value <= 0x20 { scalars.removeFirst() }
        while let last = scalars.last, last.value <= 0x20 { scalars.removeLast() }
        scalars.removeAll { $0 == "\t" || $0 == "\n" || $0 == "\r" }

        guard let colon = scalars.firstIndex(of: ":"), colon > 0, isAlpha(scalars[0]),
              scalars[1..<colon].allSatisfy({ isAlpha($0) || isDigit($0) || $0 == "+" || $0 == "-" || $0 == "." })
        else { throw .malformed("Invalid URL") }
        let scheme = String(String.UnicodeScalarView(scalars[..<colon])).lowercased()
        var rest = Array(scalars[(colon + 1)...])

        // Everything after "#" is the fragment, which no AuthBackup link uses.
        if let hash = rest.firstIndex(of: "#") { rest = Array(rest[..<hash]) }
        var query = ""
        if let question = rest.firstIndex(of: "?") {
            query = String(String.UnicodeScalarView(rest[(question + 1)...]))
            rest = Array(rest[..<question])
        }
        // Special schemes (http:, ...) only need to be told apart from otpauth:, so the rest of them is not parsed.
        if special.contains(scheme) { return WebURL(scheme: scheme, hostname: "", pathname: "", query: query) }

        var hostname = ""
        var path = rest
        if rest.starts(with: ["/", "/"]) {
            let authority = rest[2...].prefix { $0 != "/" }
            path = Array(rest[(2 + authority.count)...])
            hostname = try host(Array(authority))
        } else if !rest.starts(with: ["/"]) {
            // "otpauth:totp/x": an opaque path, no host.
            return WebURL(scheme: scheme, hostname: "", pathname: String(String.UnicodeScalarView(rest)), query: query)
        }
        return WebURL(scheme: scheme, hostname: hostname, pathname: resolveDots(path), query: query)
    }

    /// url.searchParams.get(name): the first value, or nil.
    func queryParam(_ name: String) -> String? {
        JS.formParams(query).first { $0.name == name }?.value
    }

    // MARK: -

    private static func isAlpha(_ s: Unicode.Scalar) -> Bool { (s.value | 0x20) >= 0x61 && (s.value | 0x20) <= 0x7A }
    private static func isDigit(_ s: Unicode.Scalar) -> Bool { s.value >= 0x30 && s.value <= 0x39 }

    /// The opaque host of a non-special URL: user info and port dropped, forbidden characters rejected,
    /// non-ASCII %-escaped (as url.hostname shows it).
    private static func host(_ authority: [Unicode.Scalar]) throws(CoreError) -> String {
        var hostPort = authority
        if let at = authority.lastIndex(of: "@") { hostPort = Array(authority[(at + 1)...]) }
        var host = hostPort
        if let colon = hostPort.lastIndex(of: ":") {
            host = Array(hostPort[..<colon])
            let port = hostPort[(colon + 1)...]
            guard port.allSatisfy(isDigit) else { throw .malformed("Invalid URL") }
            if !port.isEmpty, (Int(String(String.UnicodeScalarView(port.prefix(6)))) ?? .max) > 65535 { throw .malformed("Invalid URL") }
        }
        let forbidden: Set<Unicode.Scalar> = ["\u{0}", " ", "#", "/", ":", "<", ">", "?", "@", "[", "\\", "]", "^", "|"]
        guard !host.contains(where: forbidden.contains) else { throw .malformed("Invalid URL") }
        var out = ""
        for scalar in host {
            if scalar.value < 0x20 || scalar.value > 0x7E {
                for b in String(scalar).utf8 { out += "%" + String(b, radix: 16, uppercase: true).leftPadded(to: 2) }
            } else {
                out.unicodeScalars.append(scalar)
            }
        }
        return out
    }

    /// "." and ".." segments (also written as %2e) are resolved the way the browser does: "/a/./b/../c" → "/a/c".
    private static func resolveDots(_ path: [Unicode.Scalar]) -> String {
        guard !path.isEmpty else { return "" }
        let segments = String(String.UnicodeScalarView(path.dropFirst())).split(separator: "/", omittingEmptySubsequences: false)
        var out: [Substring] = []
        for (i, segment) in segments.enumerated() {
            let last = i == segments.count - 1
            switch segment.lowercased() {
            case "..", ".%2e", "%2e.", "%2e%2e":
                if !out.isEmpty { out.removeLast() }
                if last { out.append("") }
            case ".", "%2e":
                if last { out.append("") }
            default:
                out.append(segment)
            }
        }
        return "/" + out.joined(separator: "/")
    }
}

extension String {
    func leftPadded(to width: Int, with pad: Character = "0") -> String {
        count >= width ? self : String(repeating: pad, count: width - count) + self
    }
}
