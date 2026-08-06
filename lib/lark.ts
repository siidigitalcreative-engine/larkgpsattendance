type TenantTokenResponse = {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
};

export async function getTenantAccessToken(): Promise<string> {
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("Missing LARK_APP_ID or LARK_APP_SECRET");
  }

  const response = await fetch(
    "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      cache: "no-store",
    },
  );

  const data = (await response.json()) as TenantTokenResponse;
  if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Lark token error: ${data.msg || response.statusText}`);
  }

  return data.tenant_access_token;
}

type AttendanceRecord = {
  employeeId: string;
  employeeName: string;
  attendanceType: "Check In" | "Check Out";
  latitude: number;
  longitude: number;
  accuracy: number;
  distance: number;
  siteName: string;
  submittedAt: number;
};

export async function createAttendanceRecord(record: AttendanceRecord): Promise<string> {
  const appToken = process.env.LARK_BASE_APP_TOKEN;
  const tableId = process.env.LARK_ATTENDANCE_TABLE_ID;
  if (!appToken || !tableId) {
    throw new Error("Missing LARK_BASE_APP_TOKEN or LARK_ATTENDANCE_TABLE_ID");
  }

  const token = await getTenantAccessToken();
  const response = await fetch(
    `https://open.larksuite.com/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        fields: {
          "Employee ID": record.employeeId,
          "Employee Name": record.employeeName,
          "Attendance Type": record.attendanceType,
          "Site": record.siteName,
          "Submitted At": record.submittedAt,
          "Latitude": record.latitude,
          "Longitude": record.longitude,
          "GPS Accuracy (m)": Math.round(record.accuracy),
          "Distance from Site (m)": Math.round(record.distance),
          "Location Status": "Inside approved location",
          "Submission Status": "Accepted",
        },
      }),
      cache: "no-store",
    },
  );

  const data = await response.json();
  if (!response.ok || data.code !== 0) {
    throw new Error(`Lark Base error: ${data.msg || response.statusText}`);
  }

  return data.data?.record?.record_id ?? "";
}

export async function sendGroupNotification(input: {
  employeeName: string;
  employeeId: string;
  attendanceType: string;
  siteName: string;
  distance: number;
  accuracy: number;
  submittedAt: number;
}): Promise<void> {
  const webhook = process.env.LARK_GROUP_WEBHOOK;
  if (!webhook) return;

  const time = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(input.submittedAt));

  const text = [
    `✅ ${input.attendanceType}`,
    `Employee: ${input.employeeName} (${input.employeeId})`,
    `Site: ${input.siteName}`,
    `Time: ${time}`,
    `Distance: ${Math.round(input.distance)} m`,
    `GPS accuracy: ±${Math.round(input.accuracy)} m`,
  ].join("\n");

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msg_type: "text", content: { text } }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Lark group webhook error: ${response.statusText}`);
  }
}
