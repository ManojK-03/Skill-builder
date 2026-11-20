
/* =========================================
   LEARN FORGE — REGISTRATION BACKEND
   Google Apps Script + Google Sheets
========================================= */

"use strict";

const CONFIG = {
  SHEET_NAME: "Registrations",
  CAPACITY: 40,
  LOCK_TIMEOUT: 20000,

  HEADERS: [
    "Timestamp",
    "Name",
    "Email",
    "College",
    "Year",
    "Branch",
    "Interests"
  ],

  MAX: {
    name: 100,
    email: 120,
    college: 140,
    year: 40,
    branch: 100,
    interest: 60
  }
};

const FREE_MAIL =
  /@(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|icloud|proton|protonmail)\./i;


/* RESPONSE */

function jsonResponse(ok, status, extra = {}) {
  return ContentService
    .createTextOutput(JSON.stringify({
      ok,
      status,
      ...extra
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


/* SHEET INITIALIZATION */

function getSheet() {
  const spreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error("Spreadsheet unavailable");
  }

  let sheet =
    spreadsheet.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(
      1, 1, 1, CONFIG.HEADERS.length
    ).setValues([CONFIG.HEADERS]);

    sheet.setFrozenRows(1);

    sheet.getRange(
      1, 1, 1, CONFIG.HEADERS.length
    )
      .setFontWeight("bold")
      .setBackground("#171717")
      .setFontColor("#FACC15");

    sheet.autoResizeColumns(
      1, CONFIG.HEADERS.length
    );

    sheet.getRange("A:A")
      .setNumberFormat("dd-mmm-yyyy hh:mm:ss");
  }

  return sheet;
}


/* CLEAN INPUT */

function clean(value, maxLength) {
  let result = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maxLength);

  // Prevent spreadsheet formula injection.
  if (/^[=+\-@]/.test(result)) {
    result = "'" + result;
  }

  return result;
}


/* EMAIL VALIDATION */

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
    && !FREE_MAIL.test(email);
}


/* REGISTRATION COUNT */

function getCount(sheet) {
  return Math.max(0, sheet.getLastRow() - 1);
}


/* DUPLICATE CHECK */

function emailExists(sheet, email) {
  const count = getCount(sheet);

  if (count === 0) return false;

  const emails = sheet
    .getRange(2, 3, count, 1)
    .getDisplayValues();

  return emails.some(row =>
    String(row[0]).trim().toLowerCase() === email
  );
}


/* VALIDATE REGISTRATION */

function validateRegistration(data) {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    return null;
  }

  const name = clean(data.name, CONFIG.MAX.name);

  const email = String(data.email || "")
    .trim()
    .toLowerCase()
    .slice(0, CONFIG.MAX.email);

  const college = clean(
    data.college, CONFIG.MAX.college
  );

  const year = clean(data.year, CONFIG.MAX.year);

  const branch = clean(
    data.branch, CONFIG.MAX.branch
  );

  const interests = Array.isArray(data.interests)
    ? [...new Set(data.interests)]
        .slice(0, 10)
        .map(item => clean(item, CONFIG.MAX.interest))
        .filter(Boolean)
    : [];

  const validYears = [
    "First year",
    "Second year",
    "Third year",
    "Fourth year",
    "Postgraduate"
  ];

  if (
    name.length < 2 ||
    college.length < 3 ||
    branch.length < 2 ||
    !validYears.includes(year) ||
    !interests.length ||
    !validEmail(email)
  ) {
    return null;
  }

  return {
    name,
    email,
    college,
    year,
    branch,
    interests
  };
}


/* GET API — LIVE SEAT COUNT */

function doGet(e) {
  try {
    const action = e?.parameter?.action;

    if (action !== "count") {
      return jsonResponse(false, "invalid_action");
    }

    const sheet = getSheet();
    const count = getCount(sheet);

    return jsonResponse(true, "success", {
      count,
      capacity: CONFIG.CAPACITY,
      remaining: Math.max(0, CONFIG.CAPACITY - count),
      open: count < CONFIG.CAPACITY
    });

  } catch (error) {
    console.error(error);
    return jsonResponse(false, "server_error");
  }
}


/* POST API — SAVE REGISTRATION */

function doPost(e) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT);
    locked = true;

    if (!e?.postData?.contents) {
      return jsonResponse(false, "missing_data");
    }

    let data;

    try {
      data = JSON.parse(e.postData.contents);
    } catch (error) {
      return jsonResponse(false, "invalid_json");
    }

    // Honeypot spam protection.
    if (
      data.website &&
      String(data.website).trim() !== ""
    ) {
      return jsonResponse(false, "spam");
    }

    const registration = validateRegistration(data);

    if (!registration) {
      return jsonResponse(false, "invalid");
    }

    const sheet = getSheet();
    const count = getCount(sheet);

    // Check duplicate before capacity.
    if (emailExists(sheet, registration.email)) {
      return jsonResponse(true, "duplicate", {
        count,
        capacity: CONFIG.CAPACITY
      });
    }

    if (count >= CONFIG.CAPACITY) {
      return jsonResponse(false, "full", {
        count,
        capacity: CONFIG.CAPACITY
      });
    }

    sheet.appendRow([
      new Date(),
      registration.name,
      registration.email,
      registration.college,
      registration.year,
      registration.branch,
      registration.interests.join("; ")
    ]);

    const updatedCount = count + 1;

    return jsonResponse(true, "saved", {
      count: updatedCount,
      remaining: CONFIG.CAPACITY - updatedCount,
      capacity: CONFIG.CAPACITY
    });

  } catch (error) {
    console.error(error);
    return jsonResponse(false, "server_error");

  } finally {
    if (locked) {
      lock.releaseLock();
    }
  }
}


/* ADMIN STATISTICS */

function getRegistrationStats() {
  const sheet = getSheet();
  const count = getCount(sheet);

  const stats = {
    registered: count,
    capacity: CONFIG.CAPACITY,
    remaining: Math.max(0, CONFIG.CAPACITY - count),
    open: count < CONFIG.CAPACITY
  };

  console.log(JSON.stringify(stats, null, 2));

  return stats;
}
