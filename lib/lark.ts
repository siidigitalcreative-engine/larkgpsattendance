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
  latitude: number;
  longitude: number;
  distance: number;
  accuracy: number;
  submittedAt: number;
}): Promise<void> {
  const webhook = process.env.LARK_GROUP_WEBHOOK;
  if (!webhook) return;

  const date = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(input.submittedAt));

  const time = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(input.submittedAt));

  const isCheckIn = input.attendanceType === "Check In";
  const actionLabel = isCheckIn ? "Sign in" : "Sign out";
  const template = isCheckIn ? "blue" : "orange";
  const mapUrl = `https://www.google.com/maps?q=${input.latitude},${input.longitude}`;
  const detailsBaseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || "";

  const card = {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template,
      title: {
        tag: "plain_text",
        content: actionLabel,
      },
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**${input.employeeName} at ${input.siteName} — ${actionLabel}**\nEmployee ID: ${input.employeeId}`,
        },
      },
      {
        tag: "div",
        fields: [
          {
            is_short: true,
            text: { tag: "lark_md", content: `**${actionLabel} Date**\n${date}` },
          },
          {
            is_short: true,
            text: { tag: "lark_md", content: `**${actionLabel} Time**\n${time}` },
          },
        ],
      },
      { tag: "hr" },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: "**Check-in track**",
        },
      },
      {
        tag: "div",
        fields: [
          {
            is_short: true,
            text: { tag: "lark_md", content: "**Location validation**\n✅ Approved" },
          },
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**Distance from site**\n${Math.round(input.distance)} meters`,
            },
          },
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**GPS accuracy**\n±${Math.round(input.accuracy)} meters`,
            },
          },
        ],
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            type: "primary",
            text: { tag: "plain_text", content: "View Location" },
            url: mapUrl,
          },
          ...(detailsBaseUrl
            ? [
                {
                  tag: "button",
                  type: "default",
                  text: { tag: "plain_text", content: "Open Attendance" },
                  url: detailsBaseUrl,
                },
              ]
            : []),
        ],
      },
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: "GPS-validated attendance record saved to Lark Base.",
          },
        ],
      },
    ],
  };

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msg_type: "interactive", card }),
    cache: "no-store",
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Lark group webhook error: ${response.status} ${responseText}`);
  }

  try {
    const data = JSON.parse(responseText) as { code?: number; msg?: string };
    if (typeof data.code === "number" && data.code !== 0) {
      throw new Error(`Lark group webhook error: ${data.msg || data.code}`);
    }
  } catch (error) {
    if (error instanceof SyntaxError) return;
    throw error;
  }
}
