import { NextResponse } from "next/server";
import { verifyEmployee } from "@/lib/lark";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/session";

export const runtime = "nodejs";

type VerifyRequest = {
  employeeName?: unknown;
  mobileNumber?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as VerifyRequest;

    const employeeName =
      typeof body.employeeName === "string" ? body.employeeName.trim() : "";
    const mobileNumber =
      typeof body.mobileNumber === "string" ? body.mobileNumber.trim() : "";

    if (employeeName.length < 2 || mobileNumber.replace(/\D/g, "").length < 10) {
      return NextResponse.json(
        { error: "Select your name and enter a valid registered mobile number." },
        { status: 400 },
      );
    }

    const employee = await verifyEmployee({
      employeeName,
      mobileNumber,
    });

    if (!employee) {
      return NextResponse.json(
        {
          error:
            "The selected name and registered mobile number do not match an active employee record.",
        },
        { status: 401 },
      );
    }

    const response = NextResponse.json({
      ok: true,
      employee: {
        employeeId: employee.employeeId,
        employeeName: employee.employeeName,
        department: employee.department ?? "",
      },
    });

    response.cookies.set(
      SESSION_COOKIE_NAME,
      createSessionToken({
        employeeId: employee.employeeId,
        employeeName: employee.employeeName,
        department: employee.department,
      }),
      sessionCookieOptions,
    );

    return response;
  } catch (error) {
    console.error("Employee verification failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Employee verification failed.",
      },
      { status: 500 },
    );
  }
}
