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
  const [employeeId, setEmployeeId] = useState("");
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
        setStatus("Select your name and enter your Employee ID once on this device.");
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
        body: JSON.stringify({ employeeName: selectedName, employeeId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verification failed.");
      setEmployee(data.employee);
      setStatus("Identity verified. You will stay signed in on this device for 30 days.");
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
    setEmployeeId("");
    setPosition(null);
    setStatus("Select your name and enter your Employee ID.");
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
      setPosition(null);
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
              Verify your identity once on this device. Select your name, then enter your Employee ID.
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

              <label>
                Select your name
                <select
                  value={selectedName}
                  onChange={(event) => setSelectedName(event.target.value)}
                  required
                >
                  <option value="">Select employee</option>
                  {filteredEmployees.map((item) => (
                    <option key={`${item.employeeName}-${item.department || ""}`} value={item.employeeName}>
                      {item.employeeName}{item.department ? ` — ${item.department}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Employee ID
                <input
                  type="password"
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                  required
                  autoComplete="current-password"
                />
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
          Your identity is remembered on this browser for 30 days. Your live location is captured only when you tap the location button.
        </p>
      </section>
    </main>
  );
}
