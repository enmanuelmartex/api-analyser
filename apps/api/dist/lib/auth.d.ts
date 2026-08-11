export declare const auth: import("better-auth/*").Auth<{
    baseURL: string;
    basePath: string;
    secret: string;
    trustedOrigins: string[];
    database: (options: import("better-auth/*").BetterAuthOptions) => import("better-auth/*").DBAdapter<import("better-auth/*").BetterAuthOptions>;
    emailAndPassword: {
        enabled: true;
        minPasswordLength: number;
    };
    plugins: [{
        id: "bearer";
        version: string;
        hooks: {
            before: {
                matcher(context: import("better-auth/*").HookEndpointContext): boolean;
                handler: (inputContext: import("better-auth/*").MiddlewareInputContext<import("better-auth/*").MiddlewareOptions>) => Promise<{
                    context: {
                        headers: Headers;
                    };
                } | undefined>;
            }[];
            after: {
                matcher(context: import("better-auth/*").HookEndpointContext): true;
                handler: (inputContext: import("better-auth/*").MiddlewareInputContext<import("better-auth/*").MiddlewareOptions>) => Promise<void>;
            }[];
        };
        options: import("better-auth/plugins").BearerOptions | undefined;
    }];
    user: {
        fields: {
            image: string;
        };
        additionalFields: {
            role: {
                type: "string";
                defaultValue: string;
                input: false;
            };
            isActive: {
                type: "boolean";
                defaultValue: true;
                input: false;
            };
            ownerId: {
                type: "string";
                required: false;
                input: false;
            };
        };
    };
    databaseHooks: {
        user: {
            create: {
                before: (user: any) => Promise<{
                    data: any;
                }>;
            };
        };
        session: {
            create: {
                after: (session: any) => Promise<void>;
            };
        };
    };
}>;
