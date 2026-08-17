"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

type Position = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: number;
};

type DeviceType = "Mobile" | "Desktop";

type AttendanceGroup = "Office" | "Warehouse" | "Promodiser" | "Field Work";

const REMEMBERED_IDENTITY_KEY = "larkAttendanceRememberedIdentity";
const APP_VERSION_KEY = "larkAttendanceAppVersion";

type Employee = {
  employeeId: string;
  employeeName: string;
  department?: string;
  attendanceGroups?: AttendanceGroup[];
};

type EmployeeOption = {
  employeeName: string;
  department?: string;
};

function formatPhilippineMobileNumber(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)]
    .filter(Boolean)
    .join(" ");
}

function detectDeviceType(): DeviceType {
  if (typeof navigator === "undefined") return "Desktop";
  const ua = navigator.userAgent || "";
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(ua);
  const touchTablet =
    navigator.maxTouchPoints > 1 &&
    typeof window !== "undefined" &&
    Math.min(window.screen.width, window.screen.height) <= 1024;
  return mobileUa || touchTablet ? "Mobile" : "Desktop";
}


export default function Home() {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [search, setSearch] = useState("");
  const [attendanceType, setAttendanceType] = useState<"Check In" | "Check Out">("Check In");
  const [selectedAttendanceGroup, setSelectedAttendanceGroup] = useState<AttendanceGroup | "">("");
  const [position, setPosition] = useState<Position | null>(null);
  const [deviceType, setDeviceType] = useState<DeviceType>("Desktop");
  const [note, setNote] = useState("");
  const [attendanceImage, setAttendanceImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [status, setStatus] = useState("Loading your attendance account…");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [successResult, setSuccessResult] = useState<{ type: "Check In" | "Check Out"; address: string } | null>(null);

  useEffect(() => {
    setDeviceType(detectDeviceType());

    try {
      const remembered = window.localStorage.getItem(REMEMBERED_IDENTITY_KEY);
      if (remembered) {
        const parsed = JSON.parse(remembered) as { employeeName?: string; mobileNumber?: string };
        if (parsed.employeeName) {
          setSelectedName(parsed.employeeName);
          setSearch(parsed.employeeName);
        }
        if (parsed.mobileNumber) {
          setMobileNumber(parsed.mobileNumber.replace(/\D/g, "").slice(0, 10));
        }
      }
    } catch {
      // Ignore unavailable/corrupt local storage and continue normally.
    }

    async function initialize() {
      try {
        const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
        const sessionData = await sessionResponse.json();

        if (sessionData.authenticated) {
          setEmployee(sessionData.employee);
          const groups = (sessionData.employee?.attendanceGroups || []) as AttendanceGroup[];
          setSelectedAttendanceGroup(groups.length === 1 ? groups[0] : "");
          setStatus("Ready to capture your location.");
          return;
        }

        await loadEmployeeOptions();
        setStatus("Select your name and enter your registered mobile number once on this device.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to initialize attendance.");
      } finally {
        setLoading(false);
      }
    }

    void initialize();
  }, []);

  useEffect(() => {
    let checking = false;

    async function checkForNewVersion() {
      if (checking) return;
      checking = true;

      try {
        const response = await fetch(`/api/version?ts=${Date.now()}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) return;

        const data = (await response.json()) as { version?: string };
        const serverVersion = String(data.version || "").trim();
        if (!serverVersion) return;

        const savedVersion = window.localStorage.getItem(APP_VERSION_KEY);

        // First run after installing this feature: remember the current version.
        if (!savedVersion) {
          window.localStorage.setItem(APP_VERSION_KEY, serverVersion);
          return;
        }

        if (savedVersion !== serverVersion) {
          // Save first to prevent a reload loop, then add a cache-busting query.
          window.localStorage.setItem(APP_VERSION_KEY, serverVersion);
          const url = new URL(window.location.href);
          url.searchParams.set("appVersion", serverVersion.slice(0, 16));
          url.searchParams.set("_refresh", String(Date.now()));
          window.location.replace(url.toString());
        }
      } catch {
        // Version checking must never block attendance.
      } finally {
        checking = false;
      }
    }

    void checkForNewVersion();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void checkForNewVersion();
      }
    };

    const onFocus = () => {
      void checkForNewVersion();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  const filteredEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return employees.slice(0, 20);
    return employees.filter((item) => item.employeeName.toLowerCase().includes(query)).slice(0, 20);
  }, [employees, search]);

  async function loadEmployeeOptions() {
    const employeeResponse = await fetch(`/api/employees?ts=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    const employeeData = await employeeResponse.json();

    if (!employeeResponse.ok) {
      throw new Error(employeeData.error || "Unable to load employee list.");
    }

    setEmployees(employeeData.employees || []);
  }

  async function verifyIdentity(event: FormEvent) {
    event.preventDefault();
    if (!selectedName) {
      setStatus("Select your name first.");
      return;
    }

    setBusy(true);
    setStatus("Verifying your employee record…");

    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeName: selectedName,
          mobileNumber: `+63${mobileNumber}`,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verification failed.");

      setEmployee(data.employee);
      const groups = (data.employee?.attendanceGroups || []) as AttendanceGroup[];
      setSelectedAttendanceGroup(groups.length === 1 ? groups[0] : "");

      try {
        window.localStorage.setItem(
          REMEMBERED_IDENTITY_KEY,
          JSON.stringify({
            employeeName: data.employee?.employeeName || selectedName,
            mobileNumber,
          }),
        );
      } catch {
        // Remembering the form is optional; verification still succeeds.
      }

      setStatus("Identity verified. Your name and mobile number are remembered on this device.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);

    try {
      await fetch("/api/auth/logout", { method: "POST" });

      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);

      try {
        window.localStorage.removeItem(REMEMBERED_IDENTITY_KEY);
      } catch {
        // Continue even if local storage is unavailable.
      }

      setEmployee(null);
      setSelectedName("");
      setSearch("");
      setMobileNumber("");
      setPosition(null);
      setSelectedAttendanceGroup("");
      setNote("");
      setAttendanceImage(null);
      setImagePreviewUrl("");
      setStatus("Loading employee list…");

      // The app may have originally opened with an active session, so the
      // employee list was never loaded. Fetch it now before showing login.
      await loadEmployeeOptions();

      setStatus("Select your name and enter your registered mobile number.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to change employee.");
    } finally {
      setBusy(false);
    }
  }

  async function returnToRememberedLogin() {
    await fetch("/api/auth/logout", { method: "POST" });

    setEmployee(null);
    setPosition(null);
    setSelectedAttendanceGroup("");
    setNote("");
    setAttendanceImage(null);

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl("");
    }

    setSuccessResult(null);
    setStatus("Your name and mobile number are ready. Tap Verify and Continue.");
  }

  function refreshAttendancePage() {
    window.location.reload();
  }

  function captureLocation() {
    setStatus(
      deviceType === "Desktop"
        ? "Getting your desktop browser location…"
        : "Getting your live GPS location…",
    );
    setPosition(null);

    if (!navigator.geolocation) {
      setStatus("This browser does not support location services.");
      return;
    }

    const savePosition = (result: GeolocationPosition) => {
      setPosition({
        latitude: result.coords.latitude,
        longitude: result.coords.longitude,
        accuracy: result.coords.accuracy,
        // Use the moment this app receives the location. Some Android browsers
        // return an older provider timestamp even for a newly requested fix.
        capturedAt: Date.now(),
      });

      setStatus(
        deviceType === "Desktop"
          ? `Desktop location captured with ±${Math.round(result.coords.accuracy)} m accuracy.`
          : `Live location captured with ±${Math.round(result.coords.accuracy)} m accuracy.`,
      );
    };

    const locationErrorMessage = (error: GeolocationPositionError) => {
      if (error.code === 1) {
        return "Please turn on Location and allow this browser to use your location, then tap Capture Live Location again.";
      }
      if (error.code === 2) {
        return "Please turn on Location and allow this browser to use your location, then tap Capture Live Location again.";
      }
      if (error.code === 3) {
        return "Location is taking a little longer. Keep Location on, then tap Capture Live Location again.";
      }
      return error.message || "Unable to get your location.";
    };

    const firstOptions: PositionOptions = {
      enableHighAccuracy: deviceType === "Mobile",
      timeout: deviceType === "Mobile" ? 30_000 : 25_000,
      maximumAge: 0,
    };

    navigator.geolocation.getCurrentPosition(
      savePosition,
      (firstError) => {
        // Some Android devices need a second GPS request before they return a fix.
        if (deviceType === "Mobile" && (firstError.code === 2 || firstError.code === 3)) {
          setStatus("GPS is taking longer than usual. Retrying live location…");

          navigator.geolocation.getCurrentPosition(
            savePosition,
            (secondError) => setStatus(locationErrorMessage(secondError)),
            {
              enableHighAccuracy: true,
              timeout: 45_000,
              maximumAge: 0,
            },
          );
          return;
        }

        setStatus(locationErrorMessage(firstError));
      },
      firstOptions,
    );
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl("");
    }

    if (!file) {
      setAttendanceImage(null);
      return;
    }

    if (!file.type.startsWith("image/")) {
      setStatus("Please choose an image file.");
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setStatus("Attendance image must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }

    setAttendanceImage(file);
    setImagePreviewUrl(URL.createObjectURL(file));
  }

  const mapPreviewUrl = useMemo(() => {
    if (!position) return "";

    const latitudeSpan = position.accuracy > 1000 ? 0.15 : 0.003;
    const longitudeSpan = position.accuracy > 1000 ? 0.2 : 0.005;
    const left = position.longitude - longitudeSpan;
    const right = position.longitude + longitudeSpan;
    const bottom = position.latitude - latitudeSpan;
    const top = position.latitude + latitudeSpan;
    const bbox = [left, bottom, right, top].map(encodeURIComponent).join("%2C");

    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${encodeURIComponent(
      position.latitude,
    )}%2C${encodeURIComponent(position.longitude)}`;
  }, [position]);

  const fullMapUrl = useMemo(() => {
    if (!position) return "";
    const zoom = position.accuracy > 5000 ? 11 : position.accuracy > 1000 ? 13 : 18;
    return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(
      position.latitude,
    )}&mlon=${encodeURIComponent(position.longitude)}#map=${zoom}/${position.latitude}/${position.longitude}`;
  }, [position]);

  async function submitAttendance(event: FormEvent) {
    event.preventDefault();

    if (!position) {
      setStatus("Capture your location first.");
      return;
    }

    const employeeGroups = employee?.attendanceGroups || [];
    const attendanceGroup =
      employeeGroups.length === 1 ? employeeGroups[0] : selectedAttendanceGroup;

    if (!attendanceGroup) {
      setStatus("Select the attendance group for this check-in/check-out.");
      return;
    }

    setBusy(true);
    setStatus("Saving your attendance…");

    try {
      const formData = new FormData();
      formData.set("attendanceType", attendanceType);
      formData.set("latitude", String(position.latitude));
      formData.set("longitude", String(position.longitude));
      formData.set("accuracy", String(position.accuracy));
      formData.set("capturedAt", String(position.capturedAt));
      formData.set("deviceType", deviceType);
      formData.set("attendanceGroup", attendanceGroup);
      formData.set("note", note.trim());

      if (attendanceImage) {
        formData.set("image", attendanceImage);
      }

      const response = await fetch("/api/attendance", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) setEmployee(null);
        throw new Error(data.error || "Attendance submission failed.");
      }

      setSuccessResult({
        type: attendanceType,
        address: data.detectedAddress,
      });
      setStatus(`Success: ${attendanceType} recorded.`);

      setTimeout(() => {
        void returnToRememberedLogin();
      }, 3000);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Attendance submission failed.");
    } finally {
      setBusy(false);
    }
  }

  const isLoginError =
    !employee &&
    /do not match|invalid employee|verification failed|select your name first/i.test(status);

  const isIdentityVerified = /identity verified/i.test(status);

  if (successResult) {
    return (
      <main
        className="shell"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 20,
        }}
      >
        <section
          className="card"
          style={{
            width: "100%",
            maxWidth: 520,
            textAlign: "center",
            padding: "42px 26px",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 78,
              height: 78,
              margin: "0 auto 20px",
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: "#ecfdf3",
              color: "#067647",
              fontSize: 42,
              fontWeight: 800,
            }}
          >
            ✓
          </div>

          <div className="eyebrow">ATTENDANCE SAVED</div>
          <h1 style={{ marginBottom: 10 }}>
            {successResult.type === "Check In" ? "Check-In Successful" : "Check-Out Successful"}
          </h1>
          <p className="intro" style={{ marginBottom: 12 }}>
            Your attendance has been successfully recorded.
          </p>
          <p
            style={{
              margin: "0 auto 18px",
              color: "#667085",
              fontSize: 13,
              lineHeight: 1.5,
              maxWidth: 420,
            }}
          >
            {successResult.address}
          </p>
          <p
            style={{
              margin: 0,
              color: "#98a2b3",
              fontSize: 12,
            }}
          >
            Returning to attendance login…
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="card">
        <div className="eyebrow">LARK ATTENDANCE</div>
        <h1>GPS Check-In / Check-Out</h1>

        {loading ? (
          <p className="intro">Loading…</p>
        ) : !employee ? (
          <>
            <p className="intro">
              Verify your identity once on this device. Select your name, then enter your registered mobile number.
            </p>

            <form onSubmit={verifyIdentity}>
              <label>
                Search your name
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Type your name"
                  autoComplete="name"
                />
              </label>

              {search.trim() ? (
                <div role="listbox" aria-label="Employee search results" style={{ display: "grid", gap: 8, marginTop: 10, marginBottom: 18 }}>
                  {filteredEmployees.length === 0 ? (
                    <div style={{ padding: "12px 14px", border: "1px dashed #d8dee8", borderRadius: 12, background: "#f8fafc", color: "#667085", fontSize: 13 }}>
                      No matching employee found.
                    </div>
                  ) : (
                    filteredEmployees.map((item) => {
                      const isSelected = selectedName === item.employeeName;
                      const initials = item.employeeName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");

                      return (
                        <button
                          type="button"
                          key={`${item.employeeName}-${item.department || ""}`}
                          onClick={() => {
                            setSelectedName(item.employeeName);
                            setSearch(item.employeeName);
                          }}
                          aria-selected={isSelected}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "12px 14px",
                            border: isSelected ? "1px solid #3370ff" : "1px solid #d8dee8",
                            borderRadius: 12,
                            background: isSelected ? "#f2f6ff" : "#ffffff",
                            boxShadow: isSelected ? "0 0 0 3px rgba(51, 112, 255, 0.10)" : "none",
                            color: "#172033",
                            textAlign: "left",
                            cursor: "pointer",
                            appearance: "none",
                            WebkitAppearance: "none",
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              width: 38,
                              height: 38,
                              flex: "0 0 38px",
                              display: "grid",
                              placeItems: "center",
                              borderRadius: "50%",
                              background: isSelected ? "#3370ff" : "#eef3ff",
                              color: isSelected ? "#ffffff" : "#3370ff",
                              fontSize: 13,
                              fontWeight: 800,
                            }}
                          >
                            {initials || "•"}
                          </span>

                          <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 3 }}>
                            <strong style={{ display: "block", fontSize: 14, lineHeight: 1.3 }}>{item.employeeName}</strong>
                            {item.department ? (
                              <span style={{ display: "block", color: "#667085", fontSize: 12, lineHeight: 1.3 }}>{item.department}</span>
                            ) : null}
                          </span>

                          <span aria-hidden="true" style={{ flex: "0 0 auto", color: isSelected ? "#3370ff" : "#98a2b3", fontSize: 18, fontWeight: 700 }}>
                            {isSelected ? "✓" : "›"}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}

              <label>
                Registered mobile number
                <div className="phone-input">
                  <span className="phone-prefix">+63</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={formatPhilippineMobileNumber(mobileNumber)}
                    onChange={(event) => setMobileNumber(event.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="917 123 4567"
                    maxLength={12}
                    required
                    autoComplete="tel-national"
                  />
                </div>
                <span className="field-hint">Enter the remaining 10 digits, beginning with 9.</span>
              </label>

              <button className="primary" type="submit" disabled={busy}>
                {busy ? "Verifying…" : "Verify and Continue"}
              </button>

              <button className="secondary" type="button" onClick={refreshAttendancePage} disabled={busy}>
                Refresh Attendance
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="status">
              <strong>{employee.employeeName}</strong><br />
              {employee.employeeId}{employee.department ? ` · ${employee.department}` : ""}
            </div>

            <div
              style={{
                margin: "12px 0",
                padding: "10px 12px",
                borderRadius: 12,
                background: deviceType === "Desktop" ? "#fff7ed" : "#f0fdf4",
                border: deviceType === "Desktop" ? "1px solid #fed7aa" : "1px solid #bbf7d0",
                color: deviceType === "Desktop" ? "#9a3412" : "#166534",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              <strong>Device detected: {deviceType}</strong><br />
              {deviceType === "Desktop"
                ? "Desktop attendance is allowed. Browser location may be approximate and will be recorded as such."
                : "Mobile attendance uses live GPS and the normal accuracy requirement."}
            </div>

            <form onSubmit={submitAttendance}>
              <div className="segmented" aria-label="Attendance type">
                {(["Check In", "Check Out"] as const).map((type) => (
                  <button type="button" key={type} className={attendanceType === type ? "active" : ""} onClick={() => setAttendanceType(type)}>
                    {type}
                  </button>
                ))}
              </div>

              {(employee.attendanceGroups?.length || 0) > 1 ? (
                <label style={{ marginTop: 14 }}>
                  Attendance Group
                  <select
                    value={selectedAttendanceGroup}
                    onChange={(event) =>
                      setSelectedAttendanceGroup(event.target.value as AttendanceGroup)
                    }
                    required
                    style={{
                      width: "100%",
                      marginTop: 8,
                      padding: "12px 14px",
                      border: "1px solid #d8dee8",
                      borderRadius: 12,
                      background: "#ffffff",
                      font: "inherit",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="">Select where you are working</option>
                    {employee.attendanceGroups?.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">
                    Choose the group for this specific check-in or check-out.
                  </span>
                </label>
              ) : employee.attendanceGroups?.[0] ? (
                <div style={{ margin: "12px 0", padding: "10px 12px", borderRadius: 12, background: "#f8fafc", border: "1px solid #e4e7ec", color: "#344054", fontSize: 13 }}>
                  <strong>Attendance Group:</strong> {employee.attendanceGroups[0]}
                </div>
              ) : null}

              <button className="secondary" type="button" onClick={captureLocation} disabled={busy}>
                {position ? "Refresh Live Location" : "Capture Live Location"}
              </button>

              {position && mapPreviewUrl ? (
                <section aria-label="Captured location map preview" style={{ margin: "14px 0", overflow: "hidden", border: "1px solid #d8dee8", borderRadius: 14, background: "#ffffff" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "12px 14px" }}>
                    <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                      <strong style={{ color: "#172033", fontSize: 14 }}>Captured location</strong>
                      <span style={{ color: "#667085", fontSize: 12 }}>GPS accuracy: ±{Math.round(position.accuracy)} meters</span>
                      <span style={{ color: "#667085", fontSize: 12 }}>{deviceType === "Desktop" ? "Approximate Desktop Location" : "Live GPS"}</span>
                    </div>

                    <a href={fullMapUrl} target="_blank" rel="noreferrer" style={{ flexShrink: 0, color: "#3370ff", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                      View full map
                    </a>
                  </div>

                  <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", borderTop: "1px solid #e5e7eb", background: "#eef2f6" }}>
                    <iframe
                      title="Captured location"
                      src={mapPreviewUrl}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                    />
                  </div>

                  <div style={{ padding: "9px 14px 12px", borderTop: "1px solid #e5e7eb", color: "#667085", fontSize: 11, lineHeight: 1.45 }}>
                    Coordinates: {position.latitude.toFixed(6)}, {position.longitude.toFixed(6)}. If the map preview does not load on your phone, your captured coordinates are still saved. Tap <strong>View full map</strong> above to open the location directly.
                  </div>
                </section>
              ) : null}

              <label style={{ marginTop: 14 }}>
                Note <span style={{ color: "#98a2b3", fontWeight: 400 }}>(Optional)</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value.slice(0, 1000))}
                  placeholder="Add an attendance note…"
                  rows={3}
                  maxLength={1000}
                  style={{ width: "100%", marginTop: 8, padding: "12px 14px", border: "1px solid #d8dee8", borderRadius: 12, resize: "vertical", font: "inherit", boxSizing: "border-box" }}
                />
                <span className="field-hint">{note.length}/1000 characters</span>
              </label>

              <label style={{ marginTop: 14 }}>
                Attendance Image <span style={{ color: "#98a2b3", fontWeight: 400 }}>(Optional)</span>
                <input
                  type="file"
                  accept="image/*"
                  capture={deviceType === "Mobile" ? "environment" : undefined}
                  onChange={handleImageChange}
                  style={{ marginTop: 8 }}
                />
                <span className="field-hint">Image file · Max 5 MB</span>
              </label>

              {imagePreviewUrl ? (
                <div style={{ marginTop: 10, overflow: "hidden", border: "1px solid #d8dee8", borderRadius: 12, background: "#f8fafc" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreviewUrl} alt="Attendance attachment preview" style={{ display: "block", width: "100%", maxHeight: 240, objectFit: "cover" }} />
                </div>
              ) : null}

              <button className="primary" type="submit" disabled={busy || !position}>
                {busy ? "Submitting…" : `Submit ${attendanceType}`}
              </button>

              <button className="secondary" type="button" onClick={refreshAttendancePage} disabled={busy}>
                Refresh Attendance
              </button>

              <button className="secondary" type="button" onClick={logout} disabled={busy}>
                Not you? Change employee
              </button>
            </form>
          </>
        )}

        <div
          className="status"
          aria-live="polite"
          role={isLoginError ? "alert" : "status"}
          style={
            isLoginError
              ? { color: "#b42318", background: "#fef3f2", border: "1px solid #fecdca" }
              : isIdentityVerified
                ? { color: "#067647", background: "#ecfdf3", border: "1px solid #abefc6" }
                : undefined
          }
        >
          {status}
        </div>

        <p className="privacy">
          Your identity stays signed in on this browser until you sign out or clear browser data. Your location is captured only when you tap the location button.
        </p>
      </section>
    </main>
  );
}
