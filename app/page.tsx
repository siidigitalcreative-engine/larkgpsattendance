"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Position = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: number;
};

type Employee = {
  employeeId: string;
  employeeName: string;
  department?: string;
};

type EmployeeOption = {
  employeeName: string;
  department?: string;
};

export default function Home() {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [search, setSearch] = useState("");
  const [attendanceType, setAttendanceType] = useState<"Check In" | "Check Out">("Check In");
  const [position, setPosition] = useState<Position | null>(null);
  const [status, setStatus] = useState("Loading your attendance account…");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function initialize() {
      try {
        const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
        const sessionData = await sessionResponse.json();
        if (sessionData.authenticated) {
          setEmployee(sessionData.employee);
          setStatus("Ready to capture your live location.");
          return;
        }

        const employeeResponse = await fetch("/api/employees", { cache: "no-store" });
        const employeeData = await employeeResponse.json();
        if (!employeeResponse.ok) throw new Error(employeeData.error || "Unable to load employee list.");
        setEmployees(employeeData.employees || []);
        setStatus("Select your name and enter your registered mobile number once on this device.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to initialize attendance.");
      } finally {
        setLoading(false);
      }
    }
    void initialize();
  }, []);

  const filteredEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return employees.slice(0, 20);
    return employees
      .filter((item) => item.employeeName.toLowerCase().includes(query))
      .slice(0, 20);
  }, [employees, search]);

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
        body: JSON.stringify({ employeeName: selectedName, mobileNumber: `+63${mobileNumber}` }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verification failed.");
      setEmployee(data.employee);
      setStatus("Identity verified. You will stay signed in on this device until you sign out or clear browser data.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    setEmployee(null);
    setSelectedName("");
    setMobileNumber("");
    setPosition(null);
    setStatus("Select your name and enter your registered mobile number.");
    setBusy(false);
  }

  function captureLocation() {
    setStatus("Getting your live GPS location…");
    setPosition(null);

    if (!navigator.geolocation) {
      setStatus("This device does not support GPS location.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (result) => {
        setPosition({
          latitude: result.coords.latitude,
          longitude: result.coords.longitude,
          accuracy: result.coords.accuracy,
          capturedAt: result.timestamp,
        });
        setStatus(`Live location captured with ±${Math.round(result.coords.accuracy)} m accuracy.`);
      },
      (error) => setStatus(error.message || "Unable to get your location."),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  const mapPreviewUrl = useMemo(() => {
    if (!position) return "";

    const latitudeSpan = 0.003;
    const longitudeSpan = 0.005;
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
    return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(
      position.latitude,
    )}&mlon=${encodeURIComponent(position.longitude)}#map=18/${position.latitude}/${position.longitude}`;
  }, [position]);

  async function submitAttendance(event: FormEvent) {
    event.preventDefault();
    if (!position) {
      setStatus("Capture your live location first.");
      return;
    }

    setBusy(true);
    setStatus("Detecting your address and saving attendance…");
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendanceType, ...position }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) setEmployee(null);
        throw new Error(data.error || "Attendance submission failed.");
      }
      setStatus(`Success: ${attendanceType} recorded at ${data.detectedAddress}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Attendance submission failed.");
    } finally {
      setBusy(false);
    }
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

              <div className="employee-results" role="listbox" aria-label="Employee search results">
                {search.trim() && filteredEmployees.length === 0 ? (
                  <div className="employee-empty">No matching employee found.</div>
                ) : (
                  filteredEmployees.map((item) => {
                    const isSelected = selectedName === item.employeeName;
                    return (
                      <button
                        type="button"
                        key={`${item.employeeName}-${item.department || ""}`}
                        className={`employee-option${isSelected ? " selected" : ""}`}
                        onClick={() => {
                          setSelectedName(item.employeeName);
                          setSearch(item.employeeName);
                        }}
                        aria-selected={isSelected}
                      >
                        <span className="employee-option-name">
                          {item.employeeName}
                          {item.department ? ` · ${item.department}` : ""}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              <label>
                Registered mobile number
                <div className="phone-input">
                  <span className="phone-prefix">+63</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={mobileNumber}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "").slice(0, 10);
                      setMobileNumber(digits);
                    }}
                    placeholder="917 123 4567"
                    minLength={10}
                    maxLength={10}
                    pattern="9[0-9]{9}"
                    title="Enter the 10-digit Philippine mobile number after +63, beginning with 9."
                    required
                    autoComplete="tel-national"
                  />
                </div>
                <span className="field-hint">Enter the remaining 10 digits, beginning with 9.</span>
              </label>

              <button className="primary" type="submit" disabled={busy}>
                {busy ? "Verifying…" : "Verify and Continue"}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="status">
              <strong>{employee.employeeName}</strong><br />
              {employee.employeeId}{employee.department ? ` · ${employee.department}` : ""}
            </div>

            <form onSubmit={submitAttendance}>
              <div className="segmented" aria-label="Attendance type">
                {(["Check In", "Check Out"] as const).map((type) => (
                  <button
                    type="button"
                    key={type}
                    className={attendanceType === type ? "active" : ""}
                    onClick={() => setAttendanceType(type)}
                  >
                    {type}
                  </button>
                ))}
              </div>

              <button className="secondary" type="button" onClick={captureLocation} disabled={busy}>
                {position ? "Refresh Live Location" : "Capture Live Location"}
              </button>

              {position && mapPreviewUrl ? (
                <section className="map-preview" aria-label="Captured location map preview">
                  <div className="map-preview-header">
                    <div>
                      <strong>Captured location</strong>
                      <span>GPS accuracy ±{Math.round(position.accuracy)} meters</span>
                    </div>
                    <a href={fullMapUrl} target="_blank" rel="noreferrer">
                      View full map
                    </a>
                  </div>
                  <div className="map-frame">
                    <iframe
                      title="Captured GPS location"
                      src={mapPreviewUrl}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </section>
              ) : null}

              <button className="primary" type="submit" disabled={busy || !position}>
                {busy ? "Submitting…" : `Submit ${attendanceType}`}
              </button>

              <button className="secondary" type="button" onClick={logout} disabled={busy}>
                Not you? Change employee
              </button>
            </form>
          </>
        )}

        <div className="status" aria-live="polite">
          {status}
        </div>
        <p className="privacy">
          Your identity stays signed in on this browser until you sign out or clear browser data. Your live location is captured only when you tap the location button.
        </p>
      </section>
    </main>
  );
}
