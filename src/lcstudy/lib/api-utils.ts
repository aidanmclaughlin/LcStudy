/**
 * Shared utilities for API route handlers.
 * @module api-utils
 */

import { NextResponse } from "next/server";
import type { ApiErrorResponse } from "@/lib/types/api";

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * Create a JSON success response.
 * @param data - Response payload
 * @param status - HTTP status code (default: 200)
 */
export function jsonResponse<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}

/**
 * Create a JSON error response.
 * @param message - Error message
 * @param status - HTTP status code (default: 400)
 */
export function errorResponse(message: string, status = 400): NextResponse<ApiErrorResponse> {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Create an unauthorized error response.
 */
export function unauthorizedResponse(): NextResponse<ApiErrorResponse> {
  return errorResponse("Unauthorized", 401);
}

// =============================================================================
// Request Parsing
// =============================================================================

/**
 * Safely parse JSON from a request body.
 * Returns null if parsing fails.
 * @param request - The incoming request
 */
export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
