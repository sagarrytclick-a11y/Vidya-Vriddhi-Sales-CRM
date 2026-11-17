/**
 * Google Apps Script for Vidya Vriddhi CRM.
 *
 * Install this script in each Google Sheet that should sync leads to the CRM.
 * Store secrets in Script Properties only. Never put secrets in this file.
 *
 * Required Script Properties:
 *   CRM_URL            https://your-crm-domain.com
 *   INTEGRATION_ID     UUID returned when the integration was created
 *   WEBHOOK_SECRET     Secret shown once in the CRM integration page
 *
 * Optional Script Properties:
 *   SHEET_NAME         Tab to sync. Defaults to the active sheet.
 *   CRM_SYNC_ID_HEADER  Defaults to CRM_SYNC_ID
 *   CRM_SYNC_STATUS_HEADER Defaults to CRM_SYNC_STATUS
 *   CRM_LAST_SYNCED_HEADER Defaults to CRM_LAST_SYNCED
 *   BATCH_SIZE         Defaults to 50
 */

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const config = {
    crmUrl: (props.getProperty("CRM_URL") || "").replace(/\/+$/, ""),
    integrationId: props.getProperty("INTEGRATION_ID") || "",
    webhookSecret: props.getProperty("WEBHOOK_SECRET") || "",
    sheetName: props.getProperty("SHEET_NAME") || "",
    syncIdHeader: props.getProperty("CRM_SYNC_ID_HEADER") || "CRM_SYNC_ID",
    statusHeader: props.getProperty("CRM_SYNC_STATUS_HEADER") || "CRM_SYNC_STATUS",
    lastSyncedHeader: props.getProperty("CRM_LAST_SYNCED_HEADER") || "CRM_LAST_SYNCED",
    batchSize: Number(props.getProperty("BATCH_SIZE") || 50),
  };

  if (!config.crmUrl || !config.integrationId || !config.webhookSecret) {
    throw new Error("Set CRM_URL, INTEGRATION_ID and WEBHOOK_SECRET in Script Properties first.");
  }

  return config;
}

function getSheet_(config) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (config.sheetName) {
    const sheet = spreadsheet.getSheetByName(config.sheetName);
    if (!sheet) throw new Error("Sheet tab not found: " + config.sheetName);
    return sheet;
  }
  return spreadsheet.getActiveSheet();
}

function ensureSyncColumns_(sheet, config) {
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const columns = {
    syncId: headers.indexOf(config.syncIdHeader),
    status: headers.indexOf(config.statusHeader),
    lastSynced: headers.indexOf(config.lastSyncedHeader),
  };

  if (columns.syncId === -1) {
    columns.syncId = headers.length;
    sheet.getRange(1, columns.syncId + 1).setValue(config.syncIdHeader);
    headers.push(config.syncIdHeader);
  }
  if (columns.status === -1) {
    columns.status = headers.length;
    sheet.getRange(1, columns.status + 1).setValue(config.statusHeader);
    headers.push(config.statusHeader);
  }
  if (columns.lastSynced === -1) {
    columns.lastSynced = headers.length;
    sheet.getRange(1, columns.lastSynced + 1).setValue(config.lastSyncedHeader);
    headers.push(config.lastSyncedHeader);
  }

  return { headers: headers, columns: columns };
}

function rowValues_(sheet, row, headerCount) {
  return sheet.getRange(row, 1, 1, headerCount).getValues()[0];
}

function rowToObject_(headers, values) {
  const result = {};
  headers.forEach(function (header, index) {
    if (header) result[String(header).trim()] = values[index];
  });
  return result;
}

function getOrCreateSyncId_(sheet, row, column) {
  const cell = sheet.getRange(row, column + 1);
  let value = cell.getValue();
  if (!value) {
    value = Utilities.getUuid();
    cell.setValue(value);
  }
  return String(value);
}

function postBatch_(config, records) {
  const url = config.crmUrl + "/api/integrations/google-sheets/webhook";
  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-webhook-secret": config.webhookSecret,
    },
    payload: JSON.stringify({
      integrationId: config.integrationId,
      secret: config.webhookSecret,
      eventType: "webhook",
      spreadsheetName: SpreadsheetApp.getActiveSpreadsheet().getName(),
      sheetTabName: getSheet_(config).getName(),
      records: records,
    }),
    muteHttpExceptions: true,
  };

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      const code = response.getResponseCode();
      const text = response.getContentText();
      if (code >= 200 && code < 300) {
        return JSON.parse(text);
      }
      lastError = "HTTP " + code + ": " + text;
    } catch (error) {
      lastError = String(error);
    }
    Utilities.sleep(1000 * (attempt + 1));
  }

  throw new Error(lastError || "Webhook request failed.");
}

function syncRows_(sheet, rowNumbers, eventType) {
  const config = getConfig_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error("Another sync is already running.");
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty("SYNCING", "true");

  try {
    const prepared = ensureSyncColumns_(sheet, config);
    const headers = prepared.headers;
    const columns = prepared.columns;
    const uniqueRows = Array.from(new Set(rowNumbers)).filter(function (row) {
      return row > 1 && row <= sheet.getLastRow();
    });

    if (uniqueRows.length === 0) return { recordsReceived: 0 };

    const records = uniqueRows.map(function (row) {
      const values = rowValues_(sheet, row, headers.length);
      const syncId = getOrCreateSyncId_(sheet, row, columns.syncId);
      return {
        externalId: syncId,
        rowNumber: row,
        values: rowToObject_(headers, values),
      };
    });

    const batchSize = Math.max(1, Math.min(100, config.batchSize || 50));
    const responseSummaries = [];

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const response = postBatch_(config, batch);
      responseSummaries.push(response);

      batch.forEach(function (record) {
        sheet.getRange(record.rowNumber, columns.status + 1).setValue(response.status || "synced");
        sheet.getRange(record.rowNumber, columns.lastSynced + 1).setValue(new Date());
      });
    }

    return responseSummaries[responseSummaries.length - 1];
  } finally {
    props.deleteProperty("SYNCING");
    lock.releaseLock();
  }
}

function onEdit(e) {
  if (!e || !e.range) return;
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("SYNCING") === "true") return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;

  try {
    props.setProperty("SYNCING", "true");
    const sheet = e.range.getSheet();
    const startRow = e.range.getRow();
    const rowCount = e.range.getNumRows();
    const rows = [];
    for (let row = startRow; row < startRow + rowCount; row++) {
      if (row > 1) rows.push(row);
    }
    if (rows.length > 0) {
      syncRows_(sheet, rows, "webhook");
    }
  } catch (error) {
    console.error(error);
  } finally {
    props.deleteProperty("SYNCING");
    lock.releaseLock();
  }
}

function syncAllRows() {
  const config = getConfig_();
  const sheet = getSheet_(config);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const props = PropertiesService.getScriptProperties();
  const startRow = Number(props.getProperty("SYNC_NEXT_ROW") || 2);
  let row = Math.max(2, startRow);

  while (row <= lastRow) {
    const endRow = Math.min(row + 49, lastRow);
    const rows = [];
    for (let current = row; current <= endRow; current++) rows.push(current);
    syncRows_(sheet, rows, "manual");
    props.setProperty("SYNC_NEXT_ROW", String(endRow + 1));
    row = endRow + 1;
    Utilities.sleep(500);
  }

  props.deleteProperty("SYNC_NEXT_ROW");
}

function resetSyncProgress() {
  PropertiesService.getScriptProperties().deleteProperty("SYNC_NEXT_ROW");
}

function installTriggers() {
  uninstallTriggers();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger("onEdit").forSpreadsheet(spreadsheet).onEdit().create();
  ScriptApp.newTrigger("syncAllRows").timeBased().everyMinutes(5).create();
}

function uninstallTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
}

function testConnection() {
  const config = getConfig_();
  const url = config.crmUrl + "/api/integrations/google-sheets/webhook";
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { "x-webhook-secret": config.webhookSecret },
    payload: JSON.stringify({
      integrationId: config.integrationId,
      secret: config.webhookSecret,
      eventType: "test",
      records: [],
    }),
    muteHttpExceptions: true,
  });

  Logger.log("Status: " + response.getResponseCode());
  Logger.log(response.getContentText());
}
