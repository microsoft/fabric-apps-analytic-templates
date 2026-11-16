//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import type { QueryError, SemanticModelQueryResult } from "@microsoft/rayfin-connector-fabric-semanticmodel";
import { ConnectorsError } from "@microsoft/rayfin-connectors";
import { NetworkError, SdkError } from "@microsoft/rayfin-lib";
import type { WorkloadFailure } from "@microsoft/rayfin-lib";

/** Query diagnostics augmented with the SDK's thrown transport failure fields. */
export interface SemanticModelQueryFailure extends QueryError {
    readonly workload?: WorkloadFailure;
    readonly httpStatus?: number;
    // JavaScript can throw any value. Preserve the original cause opaquely, without interpreting its properties.
    readonly cause?: unknown;
}

/** The hook and factory executor expose the same diagnostics as an ordinary Error. */
export class SemanticModelQueryError extends Error {
    readonly category: QueryError["category"];
    readonly code: string | undefined;
    readonly details: string | undefined;
    readonly recoveryHint: string | undefined;
    readonly workload: WorkloadFailure | undefined;
    readonly httpStatus: number | undefined;

    constructor(failure: SemanticModelQueryFailure) {
        super(failure.message, { cause: failure.cause !== undefined ? failure.cause : failure });
        this.name = "SemanticModelQueryError";
        this.category = failure.category;
        this.code = failure.code;
        this.details = failure.details;
        this.recoveryHint = failure.recoveryHint;
        this.workload = failure.workload;
        this.httpStatus = failure.httpStatus;
    }
}

/** Identify throttling from typed transport/workload diagnostics, never error text or a code alone. */
export function isThrottlingError(error: Error | undefined): boolean {
    if (error instanceof SemanticModelQueryError || error instanceof NetworkError) {
        const httpStatus: number | undefined = error instanceof NetworkError ? error.status : error.httpStatus;
        const workload: WorkloadFailure | undefined = error.workload;
        return httpStatus === 429
            || (workload?.errorCode === "WorkloadException" && workload.subErrorCode === "TooManyRequests");
    }

    return false;
}

type ThrownErrorFields = Pick<SemanticModelQueryFailure, "category" | "message" | "code" | "workload" | "httpStatus">;

// JavaScript may throw any value. Keep the existing unknown boundary here rather than
// claiming arbitrary transport failures or their original causes have a known shape.
function messageOf(err: unknown): string {
    return err instanceof Error && err.message.length > 0 ? err.message : String(err);
}

function describeThrownError(err: unknown): ThrownErrorFields {
    if (err instanceof NetworkError) {
        const code = err.code ?? (err.status !== undefined ? String(err.status) : undefined);
        return {
            category: err.status === undefined ? "network" : "api",
            message: messageOf(err),
            ...(code !== undefined ? { code } : {}),
            ...(err.status !== undefined ? { httpStatus: err.status } : {}),
            ...(err.workload !== undefined ? { workload: err.workload } : {}),
        };
    }
    if (err instanceof SdkError) {
        return {
            category: "unknown",
            message: messageOf(err),
            ...(err.code !== undefined ? { code: err.code } : {}),
        };
    }
    return { category: "unknown", message: messageOf(err) };
}

export function getMissingConnectorMessage(connection: string): string {
    return (
        `No connector named "${connection}". Check that the name matches rayfin/rayfin.yml, ` +
        `or add it with \`npx rayfin connector add\`.`
    );
}

export function toThrownQueryResult(err: unknown, connection: string): SemanticModelQueryResult {
    const error: SemanticModelQueryFailure = {
        ...describeThrownError(err),
        ...(err instanceof ConnectorsError && err.code === "UNKNOWN_CONNECTOR"
            ? { message: getMissingConnectorMessage(connection) }
            : {}),
        cause: err,
    };
    return { status: "error", error, requestId: "" };
}

// Customized hooks preserved by seed upgrades may still import these helpers.
export function toError(message: string, cause?: unknown): Error {
    const error: Error & { cause?: unknown } = new Error(message);
    if (cause !== undefined) error.cause = cause;
    return error;
}

export function getErrorCause(error: SemanticModelQueryFailure): unknown {
    return "cause" in error ? error.cause : undefined;
}
