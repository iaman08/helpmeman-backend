/**
 * ==============================================================================
 * HelpMeMan — Google Sheets Bug Reports Webhook with 24-Hour Countdown Timer
 * ==============================================================================
 *
 * This version writes directly to the FIRST / ACTIVE tab (e.g. Sheet1)
 * so your data appears immediately in the sheet you have open!
 *
 * COLUMNS:
 * A: Submitted At
 * B: Name
 * C: Email
 * D: Contact No
 * E: Bug Name
 * F: Description
 * G: Google Drive Link (Clickable attachment)
 * H: Status (OPEN / IN_PROGRESS / RESOLVED)
 * I: 24H Deadline (=A{row} + 1)
 * J: Countdown Timer (24H) (Live ticking timer formula)
 * K: Report ID
 * ==============================================================================
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return responseJson({ error: 'No post data received' }, 400);
    }

    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Always use the first sheet (the active tab you are looking at)
    let sheet = ss.getSheets()[0];

    // Ensure headers exist on row 1
    ensureHeadersAndFormatting(sheet);

    const action = data.action || 'CREATE';

    if (action === 'CREATE') {
      return handleCreate(sheet, data);
    } else if (action === 'UPDATE_STATUS') {
      return handleUpdateStatus(sheet, data);
    } else if (action === 'DELETE') {
      return handleDelete(sheet, data);
    } else if (action === 'UPLOAD_FILE') {
      return handleUploadFile(data);
    }

    return responseJson({ success: true, message: 'Action not recognized, ignored' });
  } catch (error) {
    return responseJson({ success: false, error: error.toString() }, 500);
  }
}

/**
 * Save photos/videos directly to Google Drive in the user's Google account.
 */
function handleUploadFile(data) {
  if (!data.fileBase64 || !data.fileName) {
    return responseJson({ success: false, error: 'Missing fileBase64 or fileName' }, 400);
  }

  try {
    const decoded = Utilities.base64Decode(data.fileBase64);
    const blob = Utilities.newBlob(decoded, data.fileType || 'application/octet-stream', data.fileName);

    let folder;
    const folders = DriveApp.getFoldersByName('HelpMeMan Bug Reports');
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder('HelpMeMan Bug Reports');
    }

    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const driveUrl = file.getUrl();
    return responseJson({
      success: true,
      url: driveUrl,
      fileId: file.getId(),
      name: file.getName(),
    });
  } catch (err) {
    return responseJson({ success: false, error: 'DriveApp upload failed: ' + err.toString() }, 500);
  }
}

function doGet(e) {
  return responseJson({
    status: 'ok',
    service: 'HelpMeMan Bug Reports Sync',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Handle new bug report submission.
 */
function handleCreate(sheet, data) {
  const nextRow = sheet.getLastRow() + 1;
  const submittedAt = new Date();

  // Media link formula
  let mediaCell = 'No attachment';
  const url = data.googleDriveLink || data.fileUrl;
  if (url && url.startsWith('http')) {
    mediaCell = '=HYPERLINK("' + url + '", "📎 View Attachment")';
  }

  // 24-Hour Deadline formula: Submitted time (Col A) + 1 day (24h)
  const deadlineFormula = '=A' + nextRow + ' + 1';

  // 24-Hour Countdown Timer formula:
  // - If Status (Col H) is RESOLVED -> "✅ RESOLVED"
  // - If past deadline (Col I) -> "🚨 EXPIRED"
  // - Otherwise -> "23h 45m 12s remaining"
  const countdownFormula =
    '=IF(H' + nextRow + '="RESOLVED", "✅ RESOLVED", ' +
    'IF(NOW() >= I' + nextRow + ', "🚨 EXPIRED", ' +
    'TEXT(INT(MAX(0, I' + nextRow + '-NOW())*24), "00") & "h " & ' +
    'TEXT(INT(MOD(MAX(0, I' + nextRow + '-NOW())*24*60, 60)), "00") & "m " & ' +
    'TEXT(INT(MOD(MAX(0, I' + nextRow + '-NOW())*24*3600, 60)), "00") & "s remaining"))';

  sheet.getRange(nextRow, 1, 1, 11).setValues([
    [
      submittedAt,                                    // Col A: Submitted At
      data.name || 'Anonymous',                       // Col B: Name
      data.email || 'N/A',                            // Col C: Email
      data.contactNo || 'N/A',                        // Col D: Contact No
      data.bugName || 'Untitled Bug',                 // Col E: Bug Name
      data.description || 'No description provided', // Col F: Description
      mediaCell,                                      // Col G: Google Drive Link
      data.status || 'OPEN',                          // Col H: Status
      deadlineFormula,                                // Col I: 24H Deadline
      countdownFormula,                               // Col J: Countdown Timer (24H)
      data.id || 'N/A',                               // Col K: Report ID
    ],
  ]);

  // Format date columns
  sheet.getRange(nextRow, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(nextRow, 9).setNumberFormat('yyyy-mm-dd hh:mm:ss');

  // Align cells nicely
  sheet.getRange(nextRow, 1).setHorizontalAlignment('center');
  sheet.getRange(nextRow, 8).setHorizontalAlignment('center');
  sheet.getRange(nextRow, 9).setHorizontalAlignment('center');
  sheet.getRange(nextRow, 10).setHorizontalAlignment('center');
  sheet.getRange(nextRow, 11).setHorizontalAlignment('center');

  return responseJson({
    success: true,
    message: 'Bug report appended to sheet with 24-hour countdown timer',
    row: nextRow,
    id: data.id,
  });
}

/**
 * Handle status update (e.g. OPEN -> IN_PROGRESS -> RESOLVED).
 */
function handleUpdateStatus(sheet, data) {
  if (!data.id) return responseJson({ error: 'Missing ID' }, 400);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return responseJson({ success: false, message: 'Sheet is empty' });

  // Search in Column K (Report ID)
  const idCol = sheet.getRange(2, 11, lastRow - 1, 1).getValues();
  for (let i = 0; i < idCol.length; i++) {
    if (String(idCol[i][0]) === String(data.id)) {
      const targetRow = i + 2;
      sheet.getRange(targetRow, 8).setValue(data.status || 'OPEN'); // Update Col H (Status)
      return responseJson({
        success: true,
        message: 'Status updated to ' + data.status,
        row: targetRow,
      });
    }
  }

  return responseJson({ success: false, message: 'Report ID not found in sheet' });
}

/**
 * Handle report deletion.
 */
function handleDelete(sheet, data) {
  if (!data.id) return responseJson({ error: 'Missing ID' }, 400);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return responseJson({ success: false, message: 'Sheet is empty' });

  // Search in Column K (Report ID)
  const idCol = sheet.getRange(2, 11, lastRow - 1, 1).getValues();
  for (let i = 0; i < idCol.length; i++) {
    if (String(idCol[i][0]) === String(data.id)) {
      const targetRow = i + 2;
      sheet.deleteRow(targetRow);
      return responseJson({ success: true, message: 'Row deleted' });
    }
  }

  return responseJson({ success: false, message: 'Report ID not found in sheet' });
}

/**
 * Setup stylish headers and conditional formatting matching your exact columns.
 */
function ensureHeadersAndFormatting(sheet) {
  const headers = [
    'Submitted At',
    'Name',
    'Email',
    'Contact No',
    'Bug Name',
    'Description',
    'Google Drive Link',
    'Status',
    '24H Deadline',
    'Countdown Timer (24H)',
    'Report ID',
  ];

  // Set / Overwrite Row 1 headers
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Format Header Row
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#000000'); // Solid Black
  headerRange.setFontColor('#ffffff');  // White Text
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(10);
  headerRange.setHorizontalAlignment('center');
  headerRange.setWrap(true);
  sheet.setRowHeight(1, 36);

  // Freeze header row
  sheet.setFrozenRows(1);

  // Setup Conditional Formatting on Countdown column (Column J)
  setupConditionalFormatting(sheet);

  // Set column widths
  sheet.setColumnWidth(1, 155); // Submitted At
  sheet.setColumnWidth(2, 130); // Name
  sheet.setColumnWidth(3, 175); // Email
  sheet.setColumnWidth(4, 130); // Contact No
  sheet.setColumnWidth(5, 170); // Bug Name
  sheet.setColumnWidth(6, 230); // Description
  sheet.setColumnWidth(7, 150); // Attachment
  sheet.setColumnWidth(8, 110); // Status
  sheet.setColumnWidth(9, 155); // Deadline
  sheet.setColumnWidth(10, 190); // Countdown Timer
  sheet.setColumnWidth(11, 130); // Report ID
}

/**
 * Configure visual badges for Countdown Timer (Column J).
 */
function setupConditionalFormatting(sheet) {
  const countdownRange = sheet.getRange('J2:J500');

  // Rule 1: RESOLVED (Soft Green)
  const resolvedRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('RESOLVED')
    .setBackground('#dcfce7')
    .setFontColor('#15803d')
    .setBold(true)
    .setRanges([countdownRange])
    .build();

  // Rule 2: EXPIRED (Soft Red)
  const expiredRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('EXPIRED')
    .setBackground('#fee2e2')
    .setFontColor('#b91c1c')
    .setBold(true)
    .setRanges([countdownRange])
    .build();

  // Rule 3: Active Countdown (Soft Amber)
  const activeRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('remaining')
    .setBackground('#fef3c7')
    .setFontColor('#b45309')
    .setBold(true)
    .setRanges([countdownRange])
    .build();

  sheet.setConditionalFormatRules([resolvedRule, expiredRule, activeRule]);
}

function responseJson(data, status = 200) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}
