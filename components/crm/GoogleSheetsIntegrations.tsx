"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Copy,
  FileSpreadsheet,
  History,
  KeyRound,
  Link2,
  LoaderCircle,
  Pencil,
  PlugZap,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Modal } from "@/components/crm/Modal";
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

function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
        checked
          ? "border-emerald-200 bg-emerald-50/40"
          : "border-slate-200 bg-slate-50 hover:border-slate-300"
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-slate-500">{description}</span> : null}
      </span>
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
          checked ? "bg-emerald-500" : "bg-slate-300"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const tone =
    status === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "partial"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-rose-200 bg-rose-50 text-rose-700";
  const Icon = status === "success" ? CheckCircle2 : status === "partial" ? Clock3 : AlertCircle;
  return (
    <span className={`badge ${tone}`}>
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

function IconAction({
  onClick,
  title,
  disabled,
  tone = "secondary",
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  tone?: "secondary" | "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={tone === "danger" ? "icon-btn border-rose-200 text-rose-700 hover:bg-rose-50" : "icon-btn"}
    >
      {children}
    </button>
  );
}

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
  const [webhookUrl, setWebhookUrl] = useState("/api/integrations/google-sheets/webhook");
  const [deleteTarget, setDeleteTarget] = useState<GoogleSheetIntegrationView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState<{ id: string; action: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/integrations/google-sheets/webhook`);
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
    void load();
  }, []);

  function parseMapping(text: string): Record<string, string> {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Column mapping must be a JSON object.");
    }
    return parsed as Record<string, string>;
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    } catch {
      setError("Unable to copy to clipboard.");
    }
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
    setBusy({ id: integration.id, action: "toggle" });
    setError(null);
    try {
      const response = await fetch(`/api/integrations/google-sheets/${integration.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !integration.enabled }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update integration.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update integration.");
    } finally {
      setBusy(null);
    }
  }

  function requestDelete(integration: GoogleSheetIntegrationView) {
    setDeleteTarget(integration);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/integrations/google-sheets/${deleteTarget.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to delete integration.");
      if (selectedIntegration === deleteTarget.id) {
        setSelectedIntegration(null);
        setSelectedLogs([]);
      }
      if (editingId === deleteTarget.id) {
        setEditingId(null);
        setForm(emptyForm);
      }
      setDeleteTarget(null);
      setMessage("Google Sheets integration deleted.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete integration.");
    } finally {
      setDeleting(false);
    }
  }

  async function rotateSecret(integration: GoogleSheetIntegrationView) {
    if (!window.confirm("Rotate the webhook secret? The old secret will stop working.")) return;
    setBusy({ id: integration.id, action: "rotate" });
    setError(null);
    try {
      const response = await fetch(`/api/integrations/google-sheets/${integration.id}?action=rotate-secret`, {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to rotate secret.");
      setNewSecret(result.data?.secret ?? null);
      setMessage("Webhook secret rotated. Copy the new secret now.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to rotate secret.");
    } finally {
      setBusy(null);
    }
  }

  async function testIntegration(integration: GoogleSheetIntegrationView) {
    setBusy({ id: integration.id, action: "test" });
    setError(null);
    try {
      const response = await fetch(`/api/integrations/google-sheets/${integration.id}?action=test`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Integration test failed.");
      setMessage("Configuration test passed. Run the Apps Script sync function to test the live webhook.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Integration test failed.");
    } finally {
      setBusy(null);
    }
  }

  async function loadLogs(integration: GoogleSheetIntegrationView) {
    setBusy({ id: integration.id, action: "logs" });
    setError(null);
    try {
      const response = await fetch(`/api/integrations/google-sheets/${integration.id}?logs=1&limit=25`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load logs.");
      setSelectedIntegration(integration.id);
      setSelectedLogs(result.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load logs.");
    } finally {
      setBusy(null);
    }
  }

  const isBusy = (id: string, action?: string) =>
    busy?.id === id && (action ? busy.action === action : true);

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
            <FileSpreadsheet className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {editingId ? "Edit Google Sheets integration" : "Connect a Google Sheet"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Each connected sheet gets its own integration ID, mapping, webhook secret and sync history.
            </p>
          </div>
        </div>

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
              Map sheet headers to CRM fields: businessName, phoneNumber, email, cityState, category, source, remarks.
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle
              checked={form.autoAssign}
              onChange={(checked) => setForm({ ...form, autoAssign: checked })}
              label="Auto-assign new leads"
              description="Assign new synced leads to the least-loaded active rep."
            />
            <Toggle
              checked={form.enabled}
              onChange={(checked) => setForm({ ...form, enabled: checked })}
              label="Integration enabled"
              description="Allow this sheet to sync leads into Sales CRM."
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving..." : editingId ? "Update integration" : "Create integration"}
            </button>
            {editingId ? (
              <button type="button" className="btn-secondary" onClick={() => { setEditingId(null); setForm(emptyForm); }}>
                <X className="h-4 w-4" />
                Cancel edit
              </button>
            ) : null}
          </div>
        </form>
      </div>

      {newSecret ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
              <KeyRound className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-amber-900">Webhook secret (shown once)</h3>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                Store this in Google Apps Script Script Properties as <code>WEBHOOK_SECRET</code>. It will not be shown again.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="block min-w-0 flex-1 break-all rounded-xl border border-amber-200 bg-slate-50 px-3 py-2 text-xs text-slate-900">{newSecret}</code>
                <button type="button" className="icon-btn shrink-0" title="Copy secret" onClick={() => copyText(newSecret, "secret")}>
                  {copied === "secret" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <PlugZap className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-900">Connected Google Sheets</h2>
          </div>
          <span className="badge border-slate-200 bg-slate-50 text-slate-600">{integrations.length} total</span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Loading integrations...
          </div>
        ) : integrations.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <FileSpreadsheet className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-2 text-sm font-medium text-slate-700">No Google Sheets connected yet</p>
            <p className="mt-1 text-xs text-slate-500">Create an integration above to start syncing leads into Sales CRM.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {integrations.map((integration) => {
              const toggling = isBusy(integration.id, "toggle");
              return (
                <div key={integration.id} className="px-5 py-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">{integration.name}</h3>
                        <span className={`badge ${integration.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                          <Power className="h-3.5 w-3.5" />
                          {integration.enabled ? "Active" : "Disabled"}
                        </span>
                        <StatusBadge status={integration.lastSyncStatus} />
                      </div>

                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1.5">
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                          {integration.spreadsheetName ?? integration.spreadsheetId}
                          {integration.sheetTabName ? ` / ${integration.sheetTabName}` : ""}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <History className="h-3.5 w-3.5" />
                          Last sync: {integration.lastSyncedAt ? new Date(integration.lastSyncedAt).toLocaleString() : "Never"}
                        </span>
                      </div>

                      {integration.lastCounts ? (
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                          <span className="badge border-slate-200 bg-slate-50 text-slate-600">Received {integration.lastCounts.received}</span>
                          <span className="badge border-emerald-200 bg-emerald-50 text-emerald-700">Created {integration.lastCounts.created}</span>
                          <span className="badge border-sky-200 bg-sky-50 text-sky-700">Updated {integration.lastCounts.updated}</span>
                          <span className="badge border-slate-200 bg-slate-50 text-slate-600">Skipped {integration.lastCounts.skipped}</span>
                          <span className={`badge ${integration.lastCounts.failed > 0 ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>Failed {integration.lastCounts.failed}</span>
                        </div>
                      ) : null}
                      {integration.lastError ? (
                        <p className="mt-2 inline-flex items-start gap-1.5 text-xs text-rose-700">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {integration.lastError}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={integration.enabled}
                        aria-label={integration.enabled ? "Disable integration" : "Enable integration"}
                        disabled={toggling}
                        onClick={() => toggleEnabled(integration)}
                        className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-medium transition ${
                          integration.enabled
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-50 text-slate-600"
                        } disabled:opacity-60`}
                        title={integration.enabled ? "Disable sync" : "Enable sync"}
                      >
                        {toggling ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                        <span>{integration.enabled ? "On" : "Off"}</span>
                        <span className={`relative inline-flex h-5 w-9 items-center rounded-full ${integration.enabled ? "bg-emerald-500" : "bg-slate-300"}`}>
                          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${integration.enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                        </span>
                      </button>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <IconAction title="Test configuration" disabled={isBusy(integration.id, "test")} onClick={() => testIntegration(integration)}>
                          {isBusy(integration.id, "test") ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        </IconAction>
                        <IconAction title="View sync logs" disabled={isBusy(integration.id, "logs")} onClick={() => loadLogs(integration)}>
                          {isBusy(integration.id, "logs") ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
                        </IconAction>
                        <IconAction title="Edit integration" onClick={() => startEdit(integration)}>
                          <Pencil className="h-4 w-4" />
                        </IconAction>
                        <IconAction title="Rotate webhook secret" disabled={isBusy(integration.id, "rotate")} onClick={() => rotateSecret(integration)}>
                          {isBusy(integration.id, "rotate") ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        </IconAction>
                        <IconAction title="Delete integration" tone="danger" onClick={() => requestDelete(integration)}>
                          <Trash2 className="h-4 w-4" />
                        </IconAction>
                      </div>
                    </div>
                  </div>

                  {selectedIntegration === integration.id ? (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-100 p-4">
                      <div className="flex items-center justify-between">
                        <h4 className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                          <History className="h-3.5 w-3.5" />
                          Recent sync logs
                        </h4>
                        <button type="button" className="icon-btn h-8 w-8" title="Close logs" onClick={() => { setSelectedIntegration(null); setSelectedLogs([]); }}>
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      {selectedLogs.length === 0 ? (
                        <p className="mt-3 text-sm text-slate-500">No sync logs yet.</p>
                      ) : (
                        <div className="mt-3 space-y-3">
                          {selectedLogs.map((log) => (
                            <div key={log.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-slate-900">{log.eventType}</span>
                                <StatusBadge status={log.status} />
                                <span>Received {log.recordsReceived}</span>
                                <span>Created {log.recordsCreated}</span>
                                <span>Updated {log.recordsUpdated}</span>
                                <span>Skipped {log.recordsSkipped}</span>
                                <span>Failed {log.recordsFailed}</span>
                              </div>
                              <p className="mt-1 inline-flex items-center gap-1.5 text-slate-500">
                                <Clock3 className="h-3.5 w-3.5" />
                                {new Date(log.startedAt).toLocaleString()}
                              </p>
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
              );
            })}
          </div>
        )}
      </div>

      <div className="card p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-700">
            <Link2 className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Webhook endpoint</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Google Apps Script should POST to this endpoint with the integration ID and webhook secret.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="block min-w-0 flex-1 break-all rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900" suppressHydrationWarning>
                {webhookUrl}
              </code>
              <button type="button" className="icon-btn shrink-0" title="Copy webhook URL" onClick={() => copyText(webhookUrl, "webhook")}>
                {copied === "webhook" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        title="Delete Google Sheets integration?"
        description="Are you sure you want to delete this connected Google Sheet?"
        size="sm"
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {deleting ? "Deleting..." : "Yes, delete"}
            </button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-slate-600">
          {deleteTarget ? (
            <>
              This will remove <span className="font-medium text-slate-900">{deleteTarget.name}</span> and its sync
              history from Sales CRM. This action cannot be undone.
            </>
          ) : (
            "This will remove the integration and its sync history. This action cannot be undone."
          )}
        </p>
      </Modal>
    </div>
  );
}
