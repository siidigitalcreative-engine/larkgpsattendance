import { NextResponse } from "next/server";
import { z } from "zod";
import { distanceMeters } from "@/lib/geo";
import { createAttendanceRecord, sendGroupNotification } from "@/lib/lark";

export const runtime = "nodejs";

const schema = z.object({
  employeeId: z.string().trim().min(1).max(50),
  employeeName: z.string().trim().min(2).max(100),
  accessCode: z.string().min(1).max(100),
  attendanceType: z.enum(["Check In", "Check Out"]),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().max(10_000),
  capturedAt: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const expectedCode = process.env.ATTENDANCE_ACCESS_CODE;
    if (!expectedCode || input.accessCode !== expectedCode) {
      return NextResponse.json({ error: "Invalid access code." }, { status: 401 });
    }

    const siteLatitude = Number(process.env.SITE_LATITUDE);
    const siteLongitude = Number(process.env.SITE_LONGITUDE);
    const radius = Number(process.env.SITE_RADIUS_METERS ?? 100);
    const maxAccuracy = Number(process.env.MAX_GPS_ACCURACY_METERS ?? 75);
    const siteName = process.env.SITE_NAME ?? "Approved site";

    if (![siteLatitude, siteLongitude, radius, maxAccuracy].every(Number.isFinite)) {
      throw new Error("Invalid site configuration");
    }

    const ageMs = Date.now() - input.capturedAt;
    if (ageMs < -30_000 || ageMs > 120_000) {
      return NextResponse.json(
        { error: "Location reading is stale. Capture your location again." },
        { status: 400 },
      );
    }

    if (input.accuracy > maxAccuracy) {
      return NextResponse.json(
        { error: `GPS accuracy is too weak (±${Math.round(input.accuracy)} m). Move outdoors and retry.` },
        { status: 400 },
      );
    }

    const distance = distanceMeters(
      input.latitude,
      input.longitude,
      siteLatitude,
      siteLongitude,
    );

    if (distance > radius) {
      return NextResponse.json(
        {
          error: `You are ${Math.round(distance)} m from ${siteName}. Check-in is allowed only within ${radius} m.`,
          distance: Math.round(distance),
        },
        { status: 403 },
      );
    }

    const submittedAt = Date.now();
    const recordId = await createAttendanceRecord({
      employeeId: input.employeeId,
      employeeName: input.employeeName,
      attendanceType: input.attendanceType,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      distance,
      siteName,
      submittedAt,
    });

    await sendGroupNotification({
      employeeName: input.employeeName,
      employeeId: input.employeeId,
      attendanceType: input.attendanceType,
      siteName,
      distance,
      accuracy: input.accuracy,
      submittedAt,
    });

    return NextResponse.json({
      ok: true,
      recordId,
      distance: Math.round(distance),
      siteName,
      submittedAt,
    });
  } catch (error) {
    console.error(error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid submission data." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 },
    );
  }
}
