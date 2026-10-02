/**
 * Live deploy API endpoint.
 *
 * GET /api/v1/version
 * Returns the deploy serving requests now, so an open tab can tell that it
 * is running older code (see main.js).
 */

import { jsonResponse } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export function GET() {
  return jsonResponse({ version: process.env.LEGACY_ASSET_VERSION ?? null });
}
