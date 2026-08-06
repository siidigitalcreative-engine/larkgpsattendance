import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyEmployee } from "@/lib/lark";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/session";

export const runtime = "nodejs";

const schema = z.object({
  employeeName: z.string().trim().min(2).max(100),
  employeeId: z.string().trim().min(1).max(50),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const employee = await verifyEmployee(input);

    if (!employee) {
      return NextResponse.json(
        { error: "The selected name and Employee ID do not match an active employee record." },
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
    console.error(error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid employee details." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Verification failed." },
      { status: 500 },
    );
  }
}
