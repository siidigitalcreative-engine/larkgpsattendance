import { NextResponse } from "next/server";
import { z } from "zod";
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

async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Sunbeams-Lark-Attendance/1.0",
        "Accept-Language": "en",
      },
      cache: "no-store",
    });

    if (!response.ok) return "Address unavailable";
    const data = (await response.json()) as { display_name?: string };
    return data.display_name?.trim() || "Address unavailable";
  } catch {
    return "Address unavailable";
  }
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const expectedCode = process.env.ATTENDANCE_ACCESS_CODE;

    if (!expectedCode || input.accessCode !== expectedCode) {
      return NextResponse.json({ error: "Invalid access code." }, { status: 401 });
    }

    const maxAccuracy = Number(process.env.MAX_GPS_ACCURACY_METERS ?? 100);
    if (!Number.isFinite(maxAccuracy)) {
      throw new Error("Invalid MAX_GPS_ACCURACY_METERS configuration.");
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
        {
          error: `GPS accuracy is too weak (±${Math.round(input.accuracy)} m). Move near a window or outdoors and retry.`,
        },
        { status: 400 },
      );
    }

    const submittedAt = Date.now();
    const detectedAddress = await reverseGeocode(input.latitude, input.longitude);
    const mapLink = `https://www.google.com/maps?q=${input.latitude},${input.longitude}`;

    const recordId = await createAttendanceRecord({
      employeeId: input.employeeId,
      employeeName: input.employeeName,
      attendanceType: input.attendanceType,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      detectedAddress,
      mapLink,
      submittedAt,
    });

    await sendGroupNotification({
      employeeName: input.employeeName,
      employeeId: input.employeeId,
      attendanceType: input.attendanceType,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      detectedAddress,
      mapLink,
      submittedAt,
    });

    return NextResponse.json({
      ok: true,
      recordId,
      detectedAddress,
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
