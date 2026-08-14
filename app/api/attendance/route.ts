import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createAttendanceRecord,
  sendGroupNotification,
  uploadAttendanceImage,
} from "@/lib/lark";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";

const MAX_NOTE_LENGTH = 1000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DESKTOP_ACCURACY_METERS = 50_000;

type DeviceType = "Mobile" | "Desktop";
type AttendanceType = "Check In" | "Check Out";

function parseNumber(value: FormDataEntryValue | null, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${field}.`);
  return parsed;
}

function parseAttendanceType(value: FormDataEntryValue | null): AttendanceType {
  if (value === "Check In" || value === "Check Out") return value;
  throw new Error("Invalid attendance type.");
}

function parseDeviceType(value: FormDataEntryValue | null): DeviceType {
  if (value === "Mobile" || value === "Desktop") return value;
  throw new Error("Invalid device type.");
}

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
    const session = verifySessionToken(cookies().get(SESSION_COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json(
        { error: "Your session has expired. Verify your identity again." },
        { status: 401 },
      );
    }

    const formData = await request.formData();
    const attendanceType = parseAttendanceType(formData.get("attendanceType"));
    const deviceType = parseDeviceType(formData.get("deviceType"));
    const latitude = parseNumber(formData.get("latitude"), "latitude");
    const longitude = parseNumber(formData.get("longitude"), "longitude");
    const accuracy = parseNumber(formData.get("accuracy"), "GPS accuracy");
    const capturedAt = parseNumber(formData.get("capturedAt"), "location timestamp");
    const note = String(formData.get("note") ?? "").trim().slice(0, MAX_NOTE_LENGTH);

    if (latitude < -90 || latitude > 90) throw new Error("Invalid latitude.");
    if (longitude < -180 || longitude > 180) throw new Error("Invalid longitude.");
    if (accuracy <= 0) throw new Error("Invalid GPS accuracy.");

    const maxMobileAccuracy = Number(process.env.MAX_GPS_ACCURACY_METERS ?? 100);
    if (!Number.isFinite(maxMobileAccuracy)) {
      throw new Error("Invalid MAX_GPS_ACCURACY_METERS configuration.");
    }

    const ageMs = Date.now() - capturedAt;
    if (ageMs < -30_000 || ageMs > 120_000) {
      return NextResponse.json(
        { error: "Location reading is stale. Capture your location again." },
        { status: 400 },
      );
    }

    if (deviceType === "Mobile" && accuracy > maxMobileAccuracy) {
      return NextResponse.json(
        {
          error: `GPS accuracy is too weak (±${Math.round(
            accuracy,
          )} m). Move near a window or outdoors and retry.`,
        },
        { status: 400 },
      );
    }

    if (deviceType === "Desktop" && accuracy > MAX_DESKTOP_ACCURACY_METERS) {
      return NextResponse.json(
        {
          error: `Desktop location is too imprecise (±${Math.round(
            accuracy,
          )} m). Enable browser location services or connect to Wi-Fi and retry.`,
        },
        { status: 400 },
      );
    }

    const imageEntry = formData.get("image");
    let attendanceImageToken: string | undefined;

    if (imageEntry instanceof File && imageEntry.size > 0) {
      if (!imageEntry.type.startsWith("image/")) {
        return NextResponse.json(
          { error: "Attendance image must be an image file." },
          { status: 400 },
        );
      }
      if (imageEntry.size > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { error: "Attendance image must be 5 MB or smaller." },
          { status: 400 },
        );
      }
      attendanceImageToken = await uploadAttendanceImage(imageEntry);
    }

    const submittedAt = Date.now();
    const detectedAddress = await reverseGeocode(latitude, longitude);
    const mapLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
    const locationMethod =
      deviceType === "Mobile" ? "Live GPS" : "Approximate Desktop Location";

    const record = {
      employeeId: session.employeeId,
      employeeName: session.employeeName,
      attendanceGroup: session.attendanceGroup,
      attendanceType,
      latitude,
      longitude,
      accuracy,
      detectedAddress,
      mapLink,
      submittedAt,
      note,
      attendanceImageToken,
      deviceType,
      locationMethod,
    } as const;

    const recordId = await createAttendanceRecord(record);
    await sendGroupNotification(record);

    return NextResponse.json({
      ok: true,
      recordId,
      detectedAddress,
      submittedAt,
      deviceType,
      locationMethod,
    });
  } catch (error) {
    console.error("Attendance submission failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 },
    );
  }
}
