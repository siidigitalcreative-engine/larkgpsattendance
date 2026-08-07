type TenantTokenResponse = {
  code: number;
  msg: string;
  tenant_access_token?: string;
};

type EmployeeRecord = {
  employeeId: string;
  employeeName: string;
  department?: string;
  mobileNumber: string;
  active: boolean;
};

export async function getTenantAccessToken(): Promise<string> {
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Missing LARK_APP_ID or LARK_APP_SECRET");

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

function getBaseConfig() {
  const appToken = process.env.LARK_BASE_APP_TOKEN;
  if (!appToken) throw new Error("Missing LARK_BASE_APP_TOKEN");
  return { appToken };
}

function parseActive(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "yes", "active", "1"].includes(value.toLowerCase());
  if (typeof value === "number") return value === 1;
  return false;
}

export async function listActiveEmployees(): Promise<EmployeeRecord[]> {
  const tableId = process.env.LARK_EMPLOYEES_TABLE_ID;
  if (!tableId) throw new Error("Missing LARK_EMPLOYEES_TABLE_ID");
  const { appToken } = getBaseConfig();
  const token = await getTenantAccessToken();

  const employees: EmployeeRecord[] = [];
  let pageToken = "";

  do {
    const url = new URL(
      `https://open.larksuite.com/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    );
    url.searchParams.set("page_size", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || data.code !== 0) {
      throw new Error(`Lark Employees error: ${data.msg || response.statusText}`);
    }

    for (const item of data.data?.items ?? []) {
      const fields = item.fields ?? {};
      const employeeId = String(fields["Employee ID"] ?? "").trim();
      const employeeName = String(fields["Full Name"] ?? "").trim();
      const department = String(fields["Department"] ?? "").trim();
      const mobileNumber = String(fields["Mobile Number"] ?? "").trim();
      const active = parseActive(fields.Active);
      if (employeeId && employeeName && mobileNumber && active) {
        employees.push({
          employeeId,
          employeeName,
          department: department || undefined,
          mobileNumber,
          active,
        });
      }
    }

    pageToken = data.data?.has_more ? String(data.data?.page_token ?? "") : "";
  } while (pageToken);

  return employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

function normalizeMobileNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("63") && digits.length >= 12) return digits.slice(2);
  if (digits.startsWith("0") && digits.length >= 11) return digits.slice(1);
  return digits;
}

export async function verifyEmployee(input: {
  mobileNumber: string;
  employeeName: string;
}): Promise<EmployeeRecord | null> {
  const normalizeName = (value: string) => value.trim().toLowerCase();
  const submittedMobile = normalizeMobileNumber(input.mobileNumber);
  const employees = await listActiveEmployees();

  return (
    employees.find(
      (employee) =>
        normalizeName(employee.employeeName) === normalizeName(input.employeeName) &&
        normalizeMobileNumber(employee.mobileNumber) === submittedMobile,
    ) ?? null
  );
}

type AttendanceRecord = {
  employeeId: string;
  employeeName: string;
  attendanceType: "Check In" | "Check Out";
  latitude: number;
  longitude: number;
  accuracy: number;
  detectedAddress: string;
  mapLink: string;
  submittedAt: number;
};

export async function createAttendanceRecord(record: AttendanceRecord): Promise<string> {
  const tableId = process.env.LARK_ATTENDANCE_TABLE_ID;
  if (!tableId) throw new Error("Missing LARK_ATTENDANCE_TABLE_ID");
  const { appToken } = getBaseConfig();
  const token = await getTenantAccessToken();
  const attendanceId = `${record.employeeId}-${record.attendanceType === "Check In" ? "IN" : "OUT"}-${record.submittedAt}`;

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
          "Attendance ID": attendanceId,
          "Employee ID": record.employeeId,
          "Employee Name": record.employeeName,
          "Attendance Type": record.attendanceType,
          "Submitted At": record.submittedAt,
          Latitude: record.latitude,
          Longitude: record.longitude,
          "GPS Accuracy (m)": Math.round(record.accuracy),
          "Detected Address": record.detectedAddress,
          "Map Link": { link: record.mapLink, text: "View Location" },
          "Location Status": "Live GPS captured",
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

export async function sendGroupNotification(input: AttendanceRecord): Promise<void> {
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
  const detailsBaseUrl = process.env.APP_PUBLIC_URL || "";

  const card = {
    config: { wide_screen_mode: true, enable_forward: true },
    header: {
      template: isCheckIn ? "blue" : "orange",
      title: { tag: "plain_text", content: actionLabel },
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**${input.employeeName} — ${actionLabel}**\nEmployee ID: ${input.employeeId}`,
        },
      },
      {
        tag: "div",
        fields: [
          { is_short: true, text: { tag: "lark_md", content: `**${actionLabel} Date**\n${date}` } },
          { is_short: true, text: { tag: "lark_md", content: `**${actionLabel} Time**\n${time}` } },
        ],
      },
      { tag: "hr" },
      {
        tag: "div",
        text: { tag: "lark_md", content: `**Detected location**\n${input.detectedAddress}` },
      },
      {
        tag: "div",
        fields: [
          { is_short: true, text: { tag: "lark_md", content: "**Location capture**\n✅ Live GPS" } },
          {
            is_short: true,
            text: { tag: "lark_md", content: `**GPS accuracy**\n±${Math.round(input.accuracy)} meters` },
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
            url: input.mapLink,
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
        elements: [{ tag: "plain_text", content: "Verified employee attendance saved to Lark Base." }],
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
  if (!response.ok) throw new Error(`Lark group webhook error: ${response.status} ${responseText}`);
  try {
    const data = JSON.parse(responseText) as { code?: number; msg?: string };
    if (typeof data.code === "number" && data.code !== 0) {
      throw new Error(`Lark group webhook error: ${data.msg || data.code}`);
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
}
