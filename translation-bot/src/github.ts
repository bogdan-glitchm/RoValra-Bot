const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

export interface GitHubConfig {
    appId: string;
    installationId: string;
    privateKey: string;
}

function base64UrlEncode(data: ArrayBuffer | Uint8Array): string {
    const bytes = data instanceof Uint8Array
        ? data
        : new Uint8Array(data);

    let binary = "";

    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(
            ...bytes.subarray(i, i + 0x8000),
        );
    }

    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
    const base64 = pem
        .replace(/-----BEGIN RSA PRIVATE KEY-----/g, "")
        .replace(/-----END RSA PRIVATE KEY-----/g, "")
        .replace(/\s/g, "");

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes.buffer;
}

function readLength(
    bytes: Uint8Array,
    offset: number,
): { length: number; next: number } {
    const first = bytes[offset];

    if (first < 0x80) {
        return {
            length: first,
            next: offset + 1,
        };
    }

    const count = first & 0x7f;
    let length = 0;

    for (let i = 0; i < count; i++) {
        length = (length << 8) | bytes[offset + 1 + i];
    }

    return {
        length,
        next: offset + 1 + count,
    };
}

function readInteger(
    bytes: Uint8Array,
    offset: number,
): { value: Uint8Array; next: number } {
    if (bytes[offset] !== 0x02) {
        throw new Error("Invalid RSA private key");
    }

    const lengthInfo = readLength(bytes, offset + 1);
    const start = lengthInfo.next;
    const end = start + lengthInfo.length;

    let value = bytes.slice(start, end);

    if (value[0] === 0) {
        value = value.slice(1);
    }

    return {
        value,
        next: end,
    };
}

function rsaPkcs1ToJwk(pem: string): JsonWebKey {
    const bytes = new Uint8Array(pemToDer(pem));

    let offset = 0;

    if (bytes[offset] !== 0x30) {
        throw new Error("Invalid RSA private key");
    }

    const sequenceLength = readLength(bytes, offset + 1);
    offset = sequenceLength.next;

    const version = readInteger(bytes, offset);
    offset = version.next;

    const n = readInteger(bytes, offset);
    offset = n.next;

    const e = readInteger(bytes, offset);
    offset = e.next;

    const d = readInteger(bytes, offset);
    offset = d.next;

    const p = readInteger(bytes, offset);
    offset = p.next;

    const q = readInteger(bytes, offset);
    offset = q.next;

    const dp = readInteger(bytes, offset);
    offset = dp.next;

    const dq = readInteger(bytes, offset);
    offset = dq.next;

    const qi = readInteger(bytes, offset);

    return {
        kty: "RSA",
        n: base64UrlEncode(n.value),
        e: base64UrlEncode(e.value),
        d: base64UrlEncode(d.value),
        p: base64UrlEncode(p.value),
        q: base64UrlEncode(q.value),
        dp: base64UrlEncode(dp.value),
        dq: base64UrlEncode(dq.value),
        qi: base64UrlEncode(qi.value),
        ext: true,
    };
}

async function createAppJWT(config: GitHubConfig): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    const header = {
        alg: "RS256",
        typ: "JWT",
    };

    const payload = {
        iat: now - 60,
        exp: now + 9 * 60,
        iss: config.appId,
    };

    const encode = (value: object) =>
        base64UrlEncode(
            new TextEncoder().encode(JSON.stringify(value)),
        );

    const encodedHeader = encode(header);
    const encodedPayload = encode(payload);

    const unsignedToken =
        `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
        "jwk",
        rsaPkcs1ToJwk(config.privateKey),
        {
            name: "RSASSA-PKCS1-v1_5",
            hash: "SHA-256",
        },
        false,
        ["sign"],
    );

    const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        new TextEncoder().encode(unsignedToken),
    );

    return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

async function getInstallationToken(
    config: GitHubConfig,
): Promise<string> {
    const jwt = await createAppJWT(config);

    const response = await fetch(
        `${GITHUB_API}/app/installations/${config.installationId}/access_tokens`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${jwt}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": GITHUB_API_VERSION,
                "User-Agent": "RoValra-Translation-Bot",
            },
        },
    );

    if (!response.ok) {
        throw new Error(
            `Failed to get installation token: ` +
            `${response.status} ${await response.text()}`,
        );
    }

    const data = await response.json() as { token: string };

    return data.token;
}

export async function githubRequest(
    config: GitHubConfig,
    path: string,
    options: RequestInit = {},
): Promise<Response> {
    const token = await getInstallationToken(config);

    const headers = new Headers(options.headers);

    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("X-GitHub-Api-Version", GITHUB_API_VERSION);
    headers.set("User-Agent", "RoValra-Translation-Bot");

    return fetch(`${GITHUB_API}${path}`, {
        ...options,
        headers,
    });
}