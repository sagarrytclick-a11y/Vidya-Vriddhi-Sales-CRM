"use client";

import { useEffect, useState } from "react";
import type { GoogleSheetIntegrationView } from "@/lib/services/google-sheets";

interface SyncLog {
  id: string;
  eventType: string;
  status: string;
  recordsReceived: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsFailed: number;
  errorDetails: Array<{ rowNumber: number | null; externalId: string | null; message: string }>;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
}

interface CreateForm {
  name: string;
  spreadsheetId: string;
  spreadsheetName: string;
  sheetTabName: string;
  columnMappingText: string;
  autoAssign: boolean;
  enabled: boolean;
}

const emptyForm: CreateForm = {
  name: "",
  spreadsheetId: "",
  spreadsheetName: "",
  sheetTabName: "",
  columnMappingText: '{\n  "Name": "businessName",\n  "Phone Number": "phoneNumber",\n  "Email": "email",\n  "City": "cityState",\n  "State": "cityState",\n  "Course": "category",\n  "Lead Source": "source",\n  "Remarks": "remarks"\n}',
  autoAssign: true,
  enabled: true,
};

export default function GoogleSheetsIntegrationsClient() {
  const [integrations, setIntegrations] = useState<GoogleSheetIntegrationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedLogs, setSelectedLogs] = useState<SyncLog[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setWebhookUrl(`${window.location.origin}/api/integrations/google-sheets/webhook`);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/google-sheets", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load integrations.");
      setIntegrations(payload.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load integrations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function parseMapping(text: string): Record<string, string> {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Column mapping must be a JSON object.");
    }
    return parsed as Record<string, string>;
  }

  async function saveIntegration(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    setNewSecret(null);

    try {
      const columnMapping = parseMapping(form.columnMappingText);
      const payload = {
        name: form.name,
        spreadsheetId: form.spreadsheetId,
        spreadsheetName: form.spreadsheetName || null,
        sheetTabName: form.sheetTabName || null,
        columnMapping,
        autoAssign: form.autoAssign,
        enabled: form.enabled,
      };

      const response = await fetch(
        editingId ? `/api/integrations/google-sheets/${editingId}` : "/api/integrations/google-sheets",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save integration.");

      if (!editingId && result.data?.secret) {
        setNewSecret(result.data.secret);
      }

      setMessage(editingId ? "Integration updated." : "Integration created. Copy the webhook secret now.");
      setForm(emptyForm);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save integration.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(integration: GoogleSheetIntegrationView) {
    setEditingId(integration.id);
    setForm({
      name: integration.name,
      spreadsheetId: integration.spreadsheetId,
      spreadsheetName: integration.spreadsheetName ?? "",
      sheetTabName: integration.sheetTabName ?? "",
      columnMappingText: JSON.stringify(integration.columnMapping ?? {}, null, 2),
      autoAssign: integration.autoAssign,
      enabled: integration.enabled,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleEnabled(integration: GoogleSheetIntegrationView) {
    setError(null);
    const response = await fetch(`/api/integrations/google-sheets/${integration.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !integration.enabled }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "Unable to update integration.");
      return;
    }
    await load();
  }

  async function deleteIntegration(id: string) {
    if (!window.confirm("Delete this Google Sheets integration and its sync history?")) return;
    setError(null);
    const response = await fetch(`/api/integrations/google-sheets/${id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "Unable to delete integration.");
      return;
    }
    await load();
  }

  async function rotateSecret(id: string) {
    if (!window.confirm("Rotate the webhook secret? The old secret will stop working.")) return;
    setError(null);
    const response = await fetch(`/api/integrations/google-sheets/${id}?action=rotate-secret`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "Unable to rotate secret.");
      return;
    }
    setNewSecret(result.data?.secret ?? null);
    setMessage("Webhook secret rotated. Copy the new secret now.");
  }

  async function testIntegration(id: string) {
    setError(null);
    const response = await fetch(`/api/integrations/google-sheets/${id}?action=test`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "Integration test failed.");
      return;
    }
    setMessage("Configuration test passed. Run the Apps Script sync function to test the live webhook.");
  }

  async function loadLogs(id: string) {
    setError(null);
    const response = await fetch(`/api/integrations/google-sheets/${id}?logs=1&limit=25`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "Unable to load logs.");
      return;
    }
    setSelectedIntegration(id);
    setSelectedLogs(result.data ?? []);
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          {editingId ? "Edit Google Sheets integration" : "Connect a Google Sheet"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Each connected sheet gets its own integration ID, column mapping, webhook secret and sync history.
        </p>

        <form className="mt-6 grid gap-4" onSubmit={saveIntegration}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Integration name</span>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Meta Leads Sheet" required />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Spreadsheet ID</span>
              <input className="input" value={form.spreadsheetId} onChange={(e) => setForm({ ...form, spreadsheetId: e.target.value })} placeholder="1AbC..." required />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Spreadsheet name</span>
              <input className="input" value={form.spreadsheetName} onChange={(e) => setForm({ ...form, spreadsheetName: e.target.value })} placeholder="Meta Campaign Leads" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Sheet tab name</span>
              <input className="input" value={form.sheetTabName} onChange={(e) => setForm({ ...form, sheetTabName: e.target.value })} placeholder="Sheet1" />
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Column mapping (JSON)</span>
            <textarea
              className="input min-h-48 font-mono text-xs"
              value={form.columnMappingText}
              onChange={(e) => setForm({ ...form, columnMappingText: e.target.value })}
              required
            />
            <span className="text-xs text-slate-500">
              Map Google Sheet headers to CRM fields: businessName, phoneNumber, email, cityState, category, source, remarks.
            </span>
          </label>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.autoAssign} onChange={(e) => setForm({ ...form, autoAssign: e.target.checked })} />
              Auto-assign new leads to the least-loaded active rep
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              Enabled
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving..." : editingId ? "Update integration" : "Create integration"}
            </button>
            {editingId ? (
              <button type="button" className="btn-secondary" onClick={() => { setEditingId(null); setForm(emptyForm); }}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </div>

      {newSecret ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h3 className="text-sm font-semibold text-amber-900">Webhook secret (shown once)</h3>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            Store this in Google Apps Script Script Properties as WEBHOOK_SECRET. It will not be shown again.
          </p>
          <code className="mt-3 block break-all rounded-xl bg-white px-3 py-2 text-xs text-slate-900">{newSecret}</code>
        </div>
      ) : null}

      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Connected Google Sheets</h2>
          <span className="badge border-slate-200 bg-slate-50 text-slate-600">{integrations.length} total</span>
        </div>

        {loading ? (
          <p className="px-5 py-6 text-sm text-slate-500">Loading integrations...</p>
        ) : integrations.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No Google Sheets connected yet.</p>
        ) : (
          <div className="divide-y divide-slate-200">
            {integrations.map((integration) => (
              <div key={integration.id} className="px-5 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{integration.name}</h3>
                      <span className={`badge ${integration.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                        {integration.enabled ? "Active" : "Disabled"}
                      </span>
                      {integration.lastSyncStatus ? (
                        <span className={`badge ${integration.lastSyncStatus === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : integration.lastSyncStatus === "partial" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                          {integration.lastSyncStatus}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {integration.spreadsheetName ?? integration.spreadsheetId}
                      {integration.sheetTabName ? ` / ${integration.sheetTabName}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Last sync: {integration.lastSyncedAt ? new Date(integration.lastSyncedAt).toLocaleString() : "Never"}
                    </p>
                    {integration.lastCounts ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Received {integration.lastCounts.received}, created {integration.lastCounts.created}, updated {integration.lastCounts.updated}, skipped {integration.lastCounts.skipped}, failed {integration.lastCounts.failed}
                      </p>
                    ) : null}
                    {integration.lastError ? <p className="mt-1 text-xs text-rose-700">{integration.lastError}</p> : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary" onClick={() => testIntegration(integration.id)}>Test config</button>
                    <button type="button" className="btn-secondary" onClick={() => loadLogs(integration.id)}>View logs</button>
                    <button type="button" className="btn-secondary" onClick={() => startEdit(integration)}>Edit</button>
                    <button type="button" className="btn-secondary" onClick={() => toggleEnabled(integration)}>
                      {integration.enabled ? "Disable" : "Enable"}
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => rotateSecret(integration.id)}>Rotate secret</button>
                    <button type="button" className="btn-danger" onClick={() => deleteIntegration(integration.id)}>Delete</button>
                  </div>
                </div>

                {selectedIntegration === integration.id ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Recent sync logs</h4>
                      <button type="button" className="text-xs font-medium text-orange-700" onClick={() => { setSelectedIntegration(null); setSelectedLogs([]); }}>
                        Close
                      </button>
                    </div>
                    {selectedLogs.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">No sync logs yet.</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {selectedLogs.map((log) => (
                          <div key={log.id} className="rounded-xl bg-white p-3 text-xs text-slate-600">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-slate-900">{log.eventType}</span>
                              <span className={`badge ${log.status === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : log.status === "partial" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                                {log.status}
                              </span>
                              <span>Received {log.recordsReceived}</span>
                              <span>Created {log.recordsCreated}</span>
                              <span>Updated {log.recordsUpdated}</span>
                              <span>Skipped {log.recordsSkipped}</span>
                              <span>Failed {log.recordsFailed}</span>
                            </div>
                            <p className="mt-1 text-slate-500">{new Date(log.startedAt).toLocaleString()}</p>
                            {log.errorDetails.length > 0 ? (
                              <ul className="mt-2 list-disc space-y-1 pl-4 text-rose-700">
                                {log.errorDetails.map((detail, index) => (
                                  <li key={`${log.id}-${index}`}>
                                    {detail.externalId ? `${detail.externalId}: ` : ""}
                                    {detail.message}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-6">
        <h2 className="text-sm font-semibold text-slate-900">Webhook endpoint</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Google Apps Script should POST to this endpoint with the integration ID and webhook secret.
        </p>
        <code className="mt-3 block break-all rounded-xl bg-slate-900 px-3 py-2 text-xs text-white">
          {webhookUrl}
        </code>
      </div>
    </div>
  );
}
