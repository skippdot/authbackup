/// Google Authenticator's export: otpauth-migration://offline?data=<base64(protobuf MigrationPayload)>.
/// Port of extension/lib/migration.js. Schema (from the Google Authenticator sources):
///
///     MigrationPayload { repeated OtpParameters otp_parameters = 1; int32 version = 2;
///                        int32 batch_size = 3; int32 batch_index = 4; int32 batch_id = 5; }
///     OtpParameters    { bytes secret = 1; string name = 2; string issuer = 3;
///                        Algorithm algorithm = 4; DigitCount digits = 5; OtpType type = 6; int64 counter = 7; }
public enum Migration {
    public struct Batch: Sendable, Equatable, Codable {
        public var index: Int
        public var size: Int
        public var id: Int
    }

    public struct Skipped: Sendable, Equatable {
        /// The key's name or issuer; nil when the export gives neither (the app shows "No name").
        public var name: String?
        public var reason: CoreError
    }

    public struct Result: Sendable, Equatable {
        public var accounts: [OtpAccount]
        public var skipped: [Skipped]
        public var batch: Batch
    }

    // MARK: - Decoding

    /// Protobuf varints are read in full (up to 70 bits) and then turned into a Double, as `Number(BigInt)` does in the
    /// extension: damaged input must fail, or be skipped, in exactly the same places.
    private struct Reader {
        let bytes: [UInt8]
        var pos = 0

        var done: Bool { pos >= bytes.count }

        mutating func varint() throws(CoreError) -> UInt128 {
            var result: UInt128 = 0
            var shift: UInt128 = 0
            while true {
                // A protobuf varint is at most 10 bytes; a longer run is damage.
                guard pos < bytes.count, shift <= 63 else { throw .truncated }
                let byte = bytes[pos]
                pos += 1
                result |= UInt128(byte & 0x7F) << shift
                if byte & 0x80 == 0 { return result }
                shift += 7
            }
        }

        mutating func number() throws(CoreError) -> Double { Double(try varint()) }

        mutating func lengthDelimited() throws(CoreError) -> ArraySlice<UInt8> {
            let length = try varint()
            guard length <= UInt128(bytes.count - pos) else { throw .truncated }
            let end = pos + Int(length)
            defer { pos = end }
            return bytes[pos..<end]
        }

        mutating func skip(_ wireType: Int) throws(CoreError) {
            switch wireType {
            case 0: _ = try varint()
            case 2: _ = try lengthDelimited()
            case 1: try fixed(8)
            case 5: try fixed(4)
            default: throw .wireType(wireType)
            }
        }

        mutating func fixed(_ length: Int) throws(CoreError) {
            guard pos + length <= bytes.count else { throw .truncated }
            pos += length
        }

        /// The next field as (number, wire type), with the tag wrapped to 32 bits like `tag >>> 3` and `tag & 7` in JS.
        mutating func field() throws(CoreError) -> (Int, Int) {
            let tag = Self.toUInt32(try number())
            return (Int(tag >> 3), Int(tag & 7))
        }

        /// ECMAScript ToUint32 of an integral Number.
        static func toUInt32(_ x: Double) -> UInt32 {
            guard x.isFinite else { return 0 }
            let m = x.truncatingRemainder(dividingBy: 4_294_967_296)
            return UInt32(m < 0 ? m + 4_294_967_296 : m)
        }
    }

    private struct Parameters {
        var secret: [UInt8] = []
        var name = ""
        var issuer = ""
        var algorithm = 0.0
        var digits = 0.0
        var type = 0.0
        var counter: UInt128 = 0
    }

    /// TextDecoder's default: invalid sequences become U+FFFD and a leading byte order mark is dropped.
    private static func utf8(_ bytes: ArraySlice<UInt8>) -> String {
        let body = bytes.starts(with: [0xEF, 0xBB, 0xBF]) ? bytes.dropFirst(3) : bytes
        return String(decoding: body, as: UTF8.self)
    }

    private static func decodeParameters(_ bytes: ArraySlice<UInt8>) throws(CoreError) -> Parameters {
        var r = Reader(bytes: Array(bytes))
        var p = Parameters()
        while !r.done {
            let (field, wire) = try r.field()
            switch (field, wire) {
            case (1, 2): p.secret = Array(try r.lengthDelimited())
            case (2, 2): p.name = utf8(try r.lengthDelimited())
            case (3, 2): p.issuer = utf8(try r.lengthDelimited())
            case (4, 0): p.algorithm = try r.number()
            case (5, 0): p.digits = try r.number()
            case (6, 0): p.type = try r.number()
            case (7, 0): p.counter = try r.varint()
            default: try r.skip(wire)
            }
        }
        return p
    }

    private static func decodePayload(_ bytes: [UInt8]) throws(CoreError) -> (params: [Parameters], batch: Batch) {
        var r = Reader(bytes: bytes)
        var params: [Parameters] = []
        var batch = (size: 0.0, index: 0.0, id: 0.0)
        while !r.done {
            let (field, wire) = try r.field()
            switch (field, wire) {
            case (1, 2): params.append(try decodeParameters(try r.lengthDelimited()))
            case (2, 0): _ = try r.number()
            case (3, 0): batch.size = try r.number()
            case (4, 0): batch.index = try r.number()
            case (5, 0): batch.id = try r.number()
            default: try r.skip(wire)
            }
        }
        let int = { (x: Double) in Int(exactly: x) ?? (x > 0 ? Int.max : Int.min) }
        return (params, Batch(index: int(batch.index), size: int(batch.size), id: int(batch.id)))
    }

    private static func algorithm(_ code: Double) -> OtpAlgorithm? {
        switch code {
        case 2: .sha256
        case 3: .sha512
        case 4: nil // MD5
        default: .sha1
        }
    }

    public static func parse(_ uri: String) throws(CoreError) -> Result {
        let url = try WebURL.parse(JS.trim(uri))
        guard url.scheme == "otpauth-migration" else { throw .notMigration }
        guard let data = url.queryParam("data"), !data.isEmpty else { throw .noData }
        let payload = try decodePayload(try JS.base64ToBytes(data))
        var accounts: [OtpAccount] = []
        var skipped: [Skipped] = []
        for p in payload.params {
            let label = p.name.isEmpty ? (p.issuer.isEmpty ? nil : p.issuer) : p.name
            guard let algorithm = algorithm(p.algorithm) else {
                skipped.append(Skipped(name: label, reason: .md5))
                continue
            }
            guard !p.secret.isEmpty else {
                skipped.append(Skipped(name: label, reason: .noSecret))
                continue
            }
            let type: OtpType = p.type == 1 ? .hotp : .totp
            // int64 on the wire; beyond 2^53 a JS Number would silently round it.
            if type == .hotp, p.counter > 9_007_199_254_740_991 {
                skipped.append(Skipped(name: label, reason: .counter(String(p.counter))))
                continue
            }
            // Google puts "Issuer:account" in name if the original link had an issuer.
            var account = p.name
            if !p.issuer.isEmpty, account.hasPrefix(p.issuer + ":") { account = String(account.dropFirst(p.issuer.count + 1)) }
            accounts.append(OtpAccount(
                type: type, issuer: JS.trim(p.issuer), account: JS.trim(account), secret: Base32.encode(p.secret),
                algorithm: algorithm, digits: p.digits == 2 ? 8 : 6,
                period: 30, // the format has no period: Google always uses 30 s
                counter: type == .hotp ? Int(p.counter) : 0))
        }
        return Result(accounts: accounts, skipped: skipped, batch: payload.batch)
    }

    // MARK: - Encoding

    private static func varint(_ value: UInt64) -> [UInt8] {
        var v = value
        var out: [UInt8] = []
        repeat {
            var byte = UInt8(v & 0x7F)
            v >>= 7
            if v > 0 { byte |= 0x80 }
            out.append(byte)
        } while v > 0
        return out
    }

    private static func fieldVarint(_ field: UInt64, _ value: UInt64) -> [UInt8] { varint(field << 3) + varint(value) }

    private static func fieldBytes(_ field: UInt64, _ bytes: [UInt8]) -> [UInt8] {
        varint(field << 3 | 2) + varint(UInt64(bytes.count)) + bytes
    }

    private static func code(_ a: OtpAlgorithm) -> UInt64 {
        switch a {
        case .sha1: 1
        case .sha256: 2
        case .sha512: 3
        }
    }

    public static func build(_ accounts: [OtpAccount], batchIndex: Int = 0, batchSize: Int = 1, batchId: Int = 1) -> String {
        var body: [UInt8] = []
        for a in accounts {
            let name = a.issuer.isEmpty ? a.account : "\(a.issuer):\(a.account)"
            var params = fieldBytes(1, (try? Base32.decode(a.secret)) ?? [])
            params += fieldBytes(2, Array(name.utf8))
            params += fieldBytes(3, Array(a.issuer.utf8))
            params += fieldVarint(4, code(a.algorithm))
            params += fieldVarint(5, a.digits == 8 ? 2 : 1)
            params += fieldVarint(6, a.type == .hotp ? 1 : 2)
            if a.type == .hotp { params += fieldVarint(7, UInt64(max(0, a.counter))) }
            body += fieldBytes(1, params)
        }
        body += fieldVarint(2, 1) + fieldVarint(3, UInt64(max(0, batchSize))) + fieldVarint(4, UInt64(max(0, batchIndex)))
            + fieldVarint(5, UInt64(max(0, batchId)))
        return "otpauth-migration://offline?data=\(JS.encodeURIComponent(JS.bytesToBase64(body)))"
    }

    // MARK: - Export "like Google Authenticator"

    public enum Incompatibility: Sendable, Equatable {
        case period(Int), digits(Int)

        public var key: String {
            switch self {
            case .period: "gaIncompatPeriod"
            case .digits: "gaIncompatDigits"
            }
        }
    }

    /// Why a key cannot be carried by the export format without loss, or nil if it can.
    public static func incompatibility(_ a: OtpAccount) -> Incompatibility? {
        if a.type == .totp, a.period != 30 { return .period(a.period) }
        if a.digits != 6, a.digits != 8 { return .digits(a.digits) }
        return nil
    }

    public struct Plan: Sendable, Equatable {
        public var uris: [String]
        public var groups: [[OtpAccount]]
        /// Indexes into the input with the reason each key was left out.
        public var skipped: [(index: Int, reason: Incompatibility)]

        public static func == (l: Plan, r: Plan) -> Bool {
            l.uris == r.uris && l.groups == r.groups && l.skipped.elementsEqual(r.skipped) { $0.index == $1.index && $0.reason == $1.reason }
        }
    }

    /// Splits keys into QR codes of up to `maxPerQr` keys and `maxUriLength` characters, as Google does (about 10):
    /// denser codes read poorly from a screen. The length is estimated with the default batch fields, like the extension.
    public static func plan(_ accounts: [OtpAccount], maxPerQr: Int = 10, maxUriLength: Int = 1200, batchId: Int? = nil) -> Plan {
        var skipped: [(index: Int, reason: Incompatibility)] = []
        var ok: [OtpAccount] = []
        for (i, a) in accounts.enumerated() {
            if let reason = incompatibility(a) { skipped.append((i, reason)) } else { ok.append(a) }
        }
        var groups: [[OtpAccount]] = []
        var current: [OtpAccount] = []
        for a in ok {
            let next = current + [a]
            if !current.isEmpty, next.count > maxPerQr || build(next).utf8.count > maxUriLength {
                groups.append(current)
                current = [a]
            } else {
                current = next
            }
        }
        if !current.isEmpty { groups.append(current) }
        let id = batchId ?? Int(UInt32.random(in: 0...UInt32.max) & 0x7FFF_FFFF)
        let uris = groups.enumerated().map { build($1, batchIndex: $0, batchSize: groups.count, batchId: id) }
        return Plan(uris: uris, groups: groups, skipped: skipped)
    }
}
