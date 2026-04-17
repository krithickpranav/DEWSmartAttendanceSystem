import type { AttendanceRecord, PermissionRecord, WorkerRecord } from "./db";

export type ReportRange = "weekly" | "monthly" | "yearly";

/**
 * Count working days (Monday–Saturday) between startMs and endMs.
 * Both companies work 6 days a week; Sunday is a weekly off.
 */
function countWorkingDays(startMs: number, endMs: number): number {
  let count = 0;
  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(endMs);
  end.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    const day = cursor.getDay(); // 0 = Sunday
    if (day !== 0) count++; // exclude Sunday
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function calcWorkerStats(
  worker: WorkerRecord,
  attendance: AttendanceRecord[],
  permissions: PermissionRecord[],
  startMs: number,
  endMs: number,
) {
  const wAtt = attendance.filter(
    (a) =>
      a.workerId === worker.id &&
      new Date(a.date).getTime() >= startMs &&
      new Date(a.date).getTime() <= endMs,
  );
  const wPerm = permissions.filter(
    (p) => p.workerId === worker.id && p.status === "approved",
  );
  const presentDays = wAtt.filter((a) => a.status === "present").length;
  const permHours = wPerm.reduce((s, p) => s + p.hours, 0);
  const leaveDays = wAtt.filter((a) => a.status === "permission").length;
  // Use 6-day work week (Mon–Sat), excludes Sundays
  const totalDays = countWorkingDays(startMs, endMs - 1);
  const absentDays = Math.max(0, totalDays - presentDays - leaveDays);
  const totalOvertime = wAtt.reduce((s, a) => s + (a.overtime_minutes ?? 0), 0);
  const totalDelay = wAtt.reduce((s, a) => s + (a.delay_minutes ?? 0), 0);
  return {
    presentDays,
    permHours,
    absentDays,
    totalDays,
    leaveDays,
    totalOvertime,
    totalDelay,
  };
}

// Load a script from CDN by injecting a <script> tag and waiting for load
function loadScript(src: string, globalCheck: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    if (globalCheck()) {
      resolve();
      return;
    }
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export async function generateReport(
  workers: WorkerRecord[],
  attendance: AttendanceRecord[],
  permissions: PermissionRecord[],
  range: ReportRange,
  startDate: string,
  endDate: string,
  companyName?: string,
): Promise<void> {
  // Load jsPDF UMD from CDN
  await loadScript(
    "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
    () => !!(window as any).jspdf,
  );
  await loadScript(
    "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js",
    () => {
      const j = (window as any).jspdf?.jsPDF;
      return j && typeof j.prototype.autoTable === "function";
    },
  );

  const { jsPDF } = (window as any).jspdf;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime() + 86400000;

  // Header
  doc.setFillColor(11, 18, 32);
  doc.rect(0, 0, 297, 35, "F");

  // Logo placeholder
  doc.setFillColor(26, 36, 51);
  doc.roundedRect(10, 5, 20, 25, 2, 2, "F");
  doc.setTextColor(34, 197, 139);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("FACE\nATTD", 20, 13, { align: "center" });

  if (companyName) {
    doc.setTextColor(230, 237, 246);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text(companyName, 35, 12);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(154, 168, 186);
    doc.text("Attendance Report", 35, 19);
  } else {
    doc.setTextColor(230, 237, 246);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Attendance Report", 35, 16);
  }

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(154, 168, 186);
  doc.text(
    `Period: ${range.toUpperCase()} | ${startDate} to ${endDate} | Working Days: Mon–Sat (6 days/week)`,
    35,
    26,
  );
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 280, 26, {
    align: "right",
  });

  // Table
  function fm(m: number): string {
    if (!m || m <= 0) return "—";
    const h = Math.floor(m / 60);
    const mn = m % 60;
    if (h > 0 && mn > 0) return `${h}h ${mn}m`;
    if (h > 0) return `${h}h`;
    return `${mn}m`;
  }
  const rows = workers.map((w) => {
    const stats = calcWorkerStats(w, attendance, permissions, startMs, endMs);
    return [
      w.name,
      w.department,
      w.phone,
      stats.presentDays.toString(),
      stats.permHours.toFixed(1),
      stats.leaveDays.toString(),
      stats.absentDays.toString(),
      fm(stats.totalOvertime),
      fm(stats.totalDelay),
    ];
  });

  doc.autoTable({
    startY: 40,
    head: [
      [
        "Name",
        "Department",
        "Phone",
        "Present Days",
        "Permission Hrs",
        "Leaves",
        "Absent Days",
        "Total OT (min)",
        "Total Delay (min)",
      ],
    ],
    body: rows,
    headStyles: {
      fillColor: [26, 36, 51],
      textColor: [34, 197, 139],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { textColor: [230, 237, 246], fontSize: 8 },
    alternateRowStyles: { fillColor: [20, 31, 46] },
    styles: { fillColor: [27, 36, 52] },
    theme: "grid",
    tableLineColor: [43, 58, 78],
    tableLineWidth: 0.3,
  });

  // Footer
  const pageH = doc.internal.pageSize.height;
  doc.setTextColor(100, 120, 140);
  doc.setFontSize(8);
  doc.text(
    "Smart Attendance Management System \u2014 Confidential | 6-Day Work Week (Mon\u2013Sat)",
    148.5,
    pageH - 5,
    { align: "center" },
  );

  const filename = `attendance-report-${range}-${startDate}.pdf`;
  doc.save(filename);
}

export async function generateWorkerReport(
  worker: WorkerRecord,
  attendance: AttendanceRecord[],
  range: ReportRange,
  startDate: string,
  endDate: string,
  companyName?: string,
): Promise<void> {
  await loadScript(
    "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
    () => !!(window as any).jspdf,
  );
  await loadScript(
    "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js",
    () => {
      const j = (window as any).jspdf?.jsPDF;
      return j && typeof j.prototype.autoTable === "function";
    },
  );

  const { jsPDF } = (window as any).jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime() + 86400000;

  // Filter and sort attendance for this worker in date range
  const workerAtt = attendance
    .filter(
      (a) =>
        a.workerId === worker.id &&
        new Date(a.date).getTime() >= startMs &&
        new Date(a.date).getTime() <= endMs,
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  // Header
  doc.setFillColor(11, 18, 32);
  doc.rect(0, 0, 210, 40, "F");

  // Logo placeholder
  doc.setFillColor(26, 36, 51);
  doc.roundedRect(10, 7, 18, 22, 2, 2, "F");
  doc.setTextColor(34, 197, 139);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("FACE\nATTD", 19, 14, { align: "center" });

  if (companyName) {
    doc.setTextColor(230, 237, 246);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(companyName, 32, 14);
  }

  doc.setTextColor(154, 168, 186);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Worker: ${worker.name}`, 32, 21);
  if (worker.department) doc.text(`Department: ${worker.department}`, 32, 27);
  doc.text(
    `Period: ${range.toUpperCase()} | ${startDate} to ${endDate}`,
    32,
    33,
  );
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 200, 33, {
    align: "right",
  });

  // Day-by-day rows
  function fmtMins(mins: number): string {
    if (!mins || mins <= 0) return "—";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }
  const rows = workerAtt.map((a) => {
    const checkIn = a.checkIn
      ? new Date(a.checkIn).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "-";
    const checkOut = a.checkOut
      ? new Date(a.checkOut).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "-";
    const hours = a.totalHours != null ? a.totalHours.toFixed(2) : "-";
    return [
      a.date,
      a.status.charAt(0).toUpperCase() + a.status.slice(1),
      checkIn,
      checkOut,
      hours,
      fmtMins(a.delay_minutes ?? 0),
      fmtMins(a.early_leave_minutes ?? 0),
      fmtMins(a.overtime_minutes ?? 0),
    ];
  });

  doc.autoTable({
    startY: 45,
    head: [
      [
        "Date",
        "Status",
        "Check-In",
        "Check-Out",
        "Hours",
        "Delay",
        "Early Leave",
        "Overtime",
      ],
    ],
    body: rows,
    headStyles: {
      fillColor: [26, 36, 51],
      textColor: [34, 197, 139],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { textColor: [230, 237, 246], fontSize: 8 },
    alternateRowStyles: { fillColor: [20, 31, 46] },
    styles: { fillColor: [27, 36, 52] },
    theme: "grid",
    tableLineColor: [43, 58, 78],
    tableLineWidth: 0.3,
  });

  // Summary row
  const totalHours = workerAtt.reduce((s, a) => s + (a.totalHours ?? 0), 0);
  const totalDelay = workerAtt.reduce((s, a) => s + (a.delay_minutes ?? 0), 0);
  const totalOT = workerAtt.reduce((s, a) => s + (a.overtime_minutes ?? 0), 0);
  const presentDays = workerAtt.filter((a) => a.status === "present").length;

  const finalY = (doc as any).lastAutoTable.finalY + 6;
  doc.setFillColor(26, 36, 51);
  doc.rect(10, finalY, 190, 12, "F");
  doc.setTextColor(34, 197, 139);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  const totalEarly = workerAtt.reduce(
    (s, a) => s + (a.early_leave_minutes ?? 0),
    0,
  );
  function fmtM(m: number): string {
    if (!m || m <= 0) return "0m";
    const h = Math.floor(m / 60);
    const mn = m % 60;
    if (h > 0 && mn > 0) return `${h}h ${mn}m`;
    if (h > 0) return `${h}h`;
    return `${mn}m`;
  }
  doc.text(
    `Summary — Present: ${presentDays} days | Hours: ${totalHours.toFixed(2)}h | Delay: ${fmtM(totalDelay)} | Early Leave: ${fmtM(totalEarly)} | Overtime: ${fmtM(totalOT)}`,
    105,
    finalY + 7.5,
    { align: "center" },
  );

  // Footer
  const pageH = doc.internal.pageSize.height;
  doc.setTextColor(100, 120, 140);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text(
    "Smart Attendance Management System — Confidential | 6-Day Work Week (Mon–Sat)",
    105,
    pageH - 5,
    { align: "center" },
  );

  const safeName = worker.name.replace(/\s+/g, "-");
  doc.save(`worker-report-${safeName}-${range}-${startDate}.pdf`);
}
