import { NextRequest } from "next/server";
import { requireSession } from "../../../../lib/finance/api";
import { listMerchantRules } from "../../../../lib/finance/queries";

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await listMerchantRules());
}
