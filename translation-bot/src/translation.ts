import { githubRequest, GitHubConfig } from "./github";
import { applyEdits, modify } from "jsonc-parser";

const SOURCE_OWNER = "NotValra";
const TARGET_OWNER = "bogdan-glitchm";
const REPO = "RoValra";
const BASE_BRANCH = "main";

const LOCALE_DIRECTORY = "public/Assets/locales";

export interface TranslationRequest {
    langCode: string;
    key: string;
    translation: string;
}

function validateLangCode(langCode: string): void {
    if (!/^[A-Za-z0-9_-]+$/.test(langCode)) {
        throw new Error("Invalid language code");
    }
}

function setNestedValue(
    object: Record<string, unknown>,
    key: string,
    value: unknown,
): void {
    const parts = key.split(".").filter(Boolean);

    if (parts.length === 0) {
        throw new Error("Translation key cannot be empty");
    }

    let current = object;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];

        if (
            typeof current[part] !== "object" ||
            current[part] === null ||
            Array.isArray(current[part])
        ) {
            current[part] = {};
        }

        current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
}

async function loadSourceLocale(
    langCode: string,
): Promise<string> {
    const url =
        `https://raw.githubusercontent.com/NotValra/RoValra/refs/heads/main/public/Assets/locales/${langCode}.json`;

    const response = await fetch(url);

    if (response.status === 404) {
        return "{}\n";
    }

    if (!response.ok) {
        throw new Error(
            `Failed to fetch source locale: ${response.status} ${await response.text()}`,
        );
    }

    const content = await response.text();

    // Validate that the source is valid JSON and is an object.
    let parsed: unknown;

    try {
        parsed = JSON.parse(content);
    } catch {
        throw new Error(
            `Source locale ${langCode}.json contains invalid JSON`,
        );
    }

    if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
    ) {
        throw new Error(
            `Source locale ${langCode}.json must contain a JSON object`,
        );
    }

    // IMPORTANT:
    // Return the original text rather than JSON.stringify-ing it.
    return content;
}

async function getMainBranchSha(
    config: GitHubConfig,
): Promise<string> {
    const response = await githubRequest(
        config,
        `/repos/${TARGET_OWNER}/${REPO}/git/ref/heads/${BASE_BRANCH}`,
    );

    if (!response.ok) {
        throw new Error(
            `Failed to get main branch: ` +
            `${response.status} ${await response.text()}`,
        );
    }

    const data = await response.json() as {
        object: {
            sha: string;
        };
    };

    return data.object.sha;
}

async function createBranch(
    config: GitHubConfig,
    branchName: string,
    sha: string,
): Promise<void> {
    const response = await githubRequest(
        config,
        `/repos/${TARGET_OWNER}/${REPO}/git/refs`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                ref: `refs/heads/${branchName}`,
                sha,
            }),
        },
    );

    if (!response.ok) {
        throw new Error(
            `Failed to create branch: ` +
            `${response.status} ${await response.text()}`,
        );
    }
}

async function getExistingFileSha(
    config: GitHubConfig,
    branchName: string,
    filePath: string,
): Promise<string | undefined> {
    const response = await githubRequest(
        config,
        `/repos/${TARGET_OWNER}/${REPO}/contents/${filePath}` +
        `?ref=${encodeURIComponent(branchName)}`,
    );

    if (response.status === 404) {
        return undefined;
    }

    if (!response.ok) {
        throw new Error(
            `Failed to check existing file: ` +
            `${response.status} ${await response.text()}`,
        );
    }

    const data = await response.json() as {
        sha: string;
    };

    return data.sha;
}

function textToBase64(text: string): string {
    const bytes = new TextEncoder().encode(text);

    let binary = "";

    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(
            ...bytes.subarray(i, i + 0x8000),
        );
    }

    return btoa(binary);
}

async function writeLocaleFile(
    config: GitHubConfig,
    branchName: string,
    filePath: string,
    content: string,
    existingSha?: string,
): Promise<void> {
    const response = await githubRequest(
        config,
        `/repos/${TARGET_OWNER}/${REPO}/contents/${filePath}`,
        {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                message: `Add ${filePath} translation`,
                content: textToBase64(content),
                branch: branchName,
                ...(existingSha
                    ? { sha: existingSha }
                    : {}),
            }),
        },
    );

    if (!response.ok) {
        throw new Error(
            `Failed to write locale file: ` +
            `${response.status} ${await response.text()}`,
        );
    }
}

async function createPullRequest(
    config: GitHubConfig,
    branchName: string,
    langCode: string,
    key: string,
): Promise<{
    number: number;
    url: string;
}> {
    const response = await githubRequest(
        config,
        `/repos/${TARGET_OWNER}/${REPO}/pulls`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                title: `Add ${langCode} translation for ${key}`,
                head: branchName,
                base: BASE_BRANCH,
                body:
                    `This PR was automatically created by the ` +
                    `RoValra Translation Bot.\n\n` +
                    `Language: \`${langCode}\`\n` +
                    `Key: \`${key}\``,
            }),
        },
    );

    if (!response.ok) {
        throw new Error(
            `Failed to create pull request: ` +
            `${response.status} ${await response.text()}`,
        );
    }

    const data = await response.json() as {
        number: number;
        html_url: string;
    };

    return {
        number: data.number,
        url: data.html_url,
    };
}

export async function submitTranslation(
    config: GitHubConfig,
    request: TranslationRequest,
) {
    validateLangCode(request.langCode);

    if (!request.key.trim()) {
        throw new Error("Translation key cannot be empty");
    }

    if (!request.translation.trim()) {
        throw new Error("Translation cannot be empty");
    }

    const originalContent = await loadSourceLocale(
        request.langCode,
    );

    const path = request.key.split(".");

    if (path.some((part) => part.length === 0)) {
        throw new Error(
            "Translation key contains an empty path segment",
        );
    }

    const edits = modify(
        originalContent,
        path,
        request.translation,
        {
            formattingOptions: {
                tabSize: 4,
                insertSpaces: true,
                eol: "\n",
            },
        },
    );

    const content = applyEdits(
        originalContent,
        edits,
    );

    const mainSha = await getMainBranchSha(config);

    const branchName =
        `locale/${request.langCode}/${crypto.randomUUID()}`;

    await createBranch(
        config,
        branchName,
        mainSha,
    );

    const filePath =
    `${LOCALE_DIRECTORY}/${request.langCode}.json`;

    const existingSha = await getExistingFileSha(
        config,
        branchName,
        filePath,
    );

    await writeLocaleFile(
        config,
        branchName,
        filePath,
        content,
        existingSha,
    );

    const pullRequest = await createPullRequest(
        config,
        branchName,
        request.langCode,
        request.key,
    );

    return {
        branch: branchName,
        file: filePath,
        pullRequest,
    };
}