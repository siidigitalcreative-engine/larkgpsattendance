import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listActiveEmployees } from "@/lib/lark";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const token = cookies().get(SESSION_COOKIE_NAME)?.value;
    const session = verifySessionToken(token);

    if (!session) {
      return NextResponse.json(
        { authenticated: false },
        {
          headers: {
            "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
          },
        },
      );
    }

    // Refresh the employee from Lark Base on every page open/reopen.
    // The signed cookie proves identity; Lark remains the source of truth
    // for current department and Attendance Group assignments.
    const employees = await listActiveEmployees();
    const employee = employees.find(
      (item) => item.employeeId === session.employeeId,
    );

    if (!employee) {
      return NextResponse.json(
        {
          authenticated: false,
          error: "Your employee record is inactive or no longer available.",
        },
        {
          status: 401,
          headers: {
            "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
          },
        },
      );
    }

    return NextResponse.json(
      {
        authenticated: true,
        employee: {
          employeeId: employee.employeeId,
          employeeName: employee.employeeName,
          department: employee.department ?? "",
          attendanceGroups: employee.attendanceGroups,
        },
      },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
        },
      },
    );
  } catch (error) {
    console.error("Attendance session refresh failed:", error);

    return NextResponse.json(
      {
        authenticated: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to refresh attendance session.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
        },
      },
    );
  }
}
