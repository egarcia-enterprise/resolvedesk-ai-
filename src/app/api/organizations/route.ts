import { NextResponse } from "next/server";
import { listOrganizations, listUsersByOrg } from "@/lib/db";

/**
 * GET /api/organizations
 * Devuelve los clientes corporativos (Tenants) registrados en el SaaS y sus usuarios (RBAC).
 */
export async function GET() {
  const organizations = listOrganizations().map((org) => ({
    ...org,
    users: listUsersByOrg(org.id),
  }));

  return NextResponse.json({
    organizations,
    _debug: {
      endpoint: "GET /api/organizations",
      sql: "SELECT * FROM organizations ORDER BY mrr_eur DESC;",
    },
  });
}
