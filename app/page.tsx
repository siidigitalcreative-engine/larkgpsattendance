"use client";

import { FormEvent, useState } from "react";

type Position = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: number;
};

export default function Home() {
  const [employeeId, setEmployeeId] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [attendanceType, setAttendanceType] = useState<"Check In" | "Check Out">("Check In");
  const [position, setPosition] = useState<Position | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

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

  async function submit(event: FormEvent) {
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
        body: JSON.stringify({
          employeeId,
          employeeName,
          accessCode,
          attendanceType,
          ...position,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Attendance submission failed.");

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
        <p className="intro">
          Capture your current live location, then submit your attendance. Your street or place name will be detected automatically.
        </p>

        <form onSubmit={submit}>
          <label>
            Employee ID
            <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required />
          </label>

          <label>
            Full name
            <input value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} required />
          </label>

          <label>
            Access code
            <input type="password" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} required />
          </label>

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
        </form>

        <div className="status" aria-live="polite">
          {status || "Location has not been captured."}
        </div>
        <p className="privacy">
          Your live location is captured only when you tap the location button and submit attendance.
        </p>
      </section>
    </main>
  );
}
