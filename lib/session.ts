import crypto from "crypto";

export const SESSION_COOKIE_NAME = "lark_attendance_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 365 * 10;

export type AttendanceGroup = string;

type SessionPayload = {
  employeeId: string;
  employeeName: string;
  department?: string;
  attendanceGroups: AttendanceGroup[];
  exp: number;
};

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(encodedPayload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(encodedPayload).digest("base64url");
}

export function createSessionToken(input: {
  employeeId: string;
  employeeName: string;
  department?: string;
  attendanceGroups: AttendanceGroup[];
}): string {
  const payload: SessionPayload = {
    ...input,
    exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifySessionToken(token?: string | null): SessionPayload | null {
  if (!token) return null;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expected = sign(encodedPayload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(decode(encodedPayload)) as SessionPayload;

    if (
      !payload.employeeId ||
      !payload.employeeName ||
      !Array.isArray(payload.attendanceGroups) ||
      payload.attendanceGroups.length === 0 ||
      !payload.attendanceGroups.every(
        (group) => typeof group === "string" && group.trim().length > 0,
      ) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DURATION_SECONDS,
};
