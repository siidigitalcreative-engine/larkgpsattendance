import { NextResponse } from "next/server";
import { listActiveEmployees } from "@/lib/lark";

export const runtime = "nodejs";

export async function GET() {
  try {
    const employees = await listActiveEmployees();
    return NextResponse.json({
      employees: employees.map(({ employeeName, department }) => ({
        employeeName,
        department: department ?? "",
      })),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load employees." },
      { status: 500 },
    );
  }
}
