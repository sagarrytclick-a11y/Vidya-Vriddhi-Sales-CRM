import { requireAdmin } from "@/lib/auth/session";
import { PageHeader } from "@/components/crm/PageHeader";
import { listGoogleSheetIntegrations } from "@/lib/services/google-sheets";
import { listGoogleSheetSyncLogs } from "@/lib/services/google-sheets";

export const dynamic = "force-dynamic";

export default async function AutomationCenterPage() {
  const user = await requireAdmin();
  const integrations = await listGoogleSheetIntegrations(user);

  const recentLogs = (
    await Promise.all(
      integrations.slice(0, 5).map(async (integration) => {
        const logs = await listGoogleSheetSyncLogs(user, integration.id, 5);
        return logs.map((log) => ({ integrationName: integration.name, ...log }));
      }),
    )
  ).flat().sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, 20);

  const emailConfigured = Boolean(
    process.env.SMTP_HOST || process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY,
  );

  return (
    <>
      <PageHeader
        title="Automation center"
        description="Monitor Google Sheets sync, reporting, and optional email automation."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Google Sheets</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{integrations.length}</p>
          <p className="mt-1 text-xs text-slate-500">Connected integrations</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Active</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{integrations.filter((item) => item.enabled).length}</p>
          <p className="mt-1 text-xs text-slate-500">Enabled syncs</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Last status</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {integrations.length === 0 ? "None" : integrations[0].lastSyncStatus ?? "Never"}
          </p>
          <p className="mt-1 text-xs text-slate-500">Most recent integration</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Email reports</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{emailConfigured ? "Ready" : "Not configured"}</p>
          <p className="mt-1 text-xs text-slate-500">SMTP/Resend/SendGrid</p>
        </div>
      </div>

      <div className="mt-8 card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Integration status</h2>
          <a href="/dashboard/integrations/google-sheets" className="text-xs font-medium text-orange-700 hover:text-orange-800">
            Manage
          </a>
        </div>
        {integrations.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No Google Sheets connected yet.</p>
        ) : (
          <div className="divide-y divide-slate-200">
            {integrations.map((integration) => (
              <div key={integration.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">{integration.name}</p>
                  <p className="text-xs text-slate-500">
                    {integration.spreadsheetName ?? integration.spreadsheetId}
                    {integration.sheetTabName ? ` / ${integration.sheetTabName}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className={`badge ${integration.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                    {integration.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <span>Last sync: {integration.lastSyncedAt ? new Date(integration.lastSyncedAt).toLocaleString() : "Never"}</span>
                  {integration.lastCounts ? (
                    <span>
                      C{integration.lastCounts.created}/U{integration.lastCounts.updated}/S{integration.lastCounts.skipped}/F{integration.lastCounts.failed}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8 card overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Recent automation logs</h2>
        </div>
        {recentLogs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No sync logs yet.</p>
        ) : (
          <div className="divide-y divide-slate-200">
            {recentLogs.map((log) => (
              <div key={log.id} className="px-5 py-3 text-xs text-slate-600">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{log.integrationName}</span>
                  <span>{log.eventType}</span>
                  <span className={`badge ${log.status === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : log.status === "partial" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                    {log.status}
                  </span>
                  <span>R{log.recordsReceived} C{log.recordsCreated} U{log.recordsUpdated} S{log.recordsSkipped} F{log.recordsFailed}</span>
                </div>
                <p className="mt-1 text-slate-500">{new Date(log.startedAt).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8 card p-6">
        <h2 className="text-sm font-semibold text-slate-900">Manual sync</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          The CRM cannot remotely invoke Google Apps Script. Open the connected Google Sheet, then run the
          <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">syncAllRows()</code>
          function from the Apps Script editor. Installable triggers can also run it every 5 minutes.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          Optional email reports are disabled unless SMTP, Resend or SendGrid environment variables are configured.
        </p>
      </div>
    </>
  );
}
