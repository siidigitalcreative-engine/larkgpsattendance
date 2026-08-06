import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(token);
  if (!session) return NextResponse.json({ authenticated: false });

  return NextResponse.json({
    authenticated: true,
    employee: {
      employeeId: session.employeeId,
      employeeName: session.employeeName,
      department: session.department ?? "",
    },
  });
}
