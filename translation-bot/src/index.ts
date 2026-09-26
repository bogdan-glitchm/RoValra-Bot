import { submitTranslation } from "./translation";

export interface Env {
    GITHUB_APP_ID: string;
    GITHUB_INSTALLATION_ID: string;
    GITHUB_PRIVATE_KEY: string;
}

function corsHeaders(): HeadersInit {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}

function jsonResponse(
    data: unknown,
    status = 200,
): Response {
    return Response.json(data, {
        status,
        headers: corsHeaders(),
    });
}

export default {
    async fetch(
        request: Request,
        env: Env,
    ): Promise<Response> {
        const url = new URL(request.url);

        if (
            url.pathname === "/translation" &&
            request.method === "OPTIONS"
        ) {
            return new Response(null, {
                status: 204,
                headers: corsHeaders(),
            });
        }

        if (
            url.pathname === "/translation" &&
            request.method === "POST"
        ) {
            try {
                const body = await request.json();

                const result = await submitTranslation(
                    {
                        appId: env.GITHUB_APP_ID,
                        installationId: env.GITHUB_INSTALLATION_ID,
                        privateKey: env.GITHUB_PRIVATE_KEY,
                    },
                    body as {
                        langCode: string;
                        key: string;
                        translation: string;
                    },
                );

                return jsonResponse(
                    {
                        success: true,
                        message: "Translation submitted!",
                        ...result,
                    },
                    201,
                );
            } catch (error) {
                console.error(error);

                return jsonResponse(
                    {
                        success: false,
                        error: error instanceof Error
                            ? error.message
                            : String(error),
                    },
                    500,
                );
            }
        }

        return new Response("Not Found", {
            status: 404,
            headers: corsHeaders(),
        });
    },
};