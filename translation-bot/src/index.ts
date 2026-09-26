import { submitTranslation } from "./translation";

export interface Env {
    GITHUB_APP_ID: string;
    GITHUB_INSTALLATION_ID: string;
    GITHUB_PRIVATE_KEY: string;
}

export default {
    async fetch(
        request: Request,
        env: Env,
    ): Promise<Response> {
        const url = new URL(request.url);

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

                return Response.json(
                    {
                        success: true,
                        message: "Translation submitted!",
                        ...result,
                    },
                    {
                        status: 201,
                    },
                );
            } catch (error) {
                console.error(error);

                return Response.json(
                    {
                        success: false,
                        error: error instanceof Error
                            ? error.message
                            : String(error),
                    },
                    {
                        status: 500,
                    },
                );
            }
        }

        return new Response("Not Found", {
            status: 404,
        });
    },
};