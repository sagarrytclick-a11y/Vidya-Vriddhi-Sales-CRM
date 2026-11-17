import { requireAdmin } from "@/lib/auth/session";
import { PageHeader } from "@/components/crm/PageHeader";
import GoogleSheetsIntegrations from "@/components/crm/GoogleSheetsIntegrations";

export default async function GoogleSheetsIntegrationsPage() {
  await requireAdmin();

  return (
    <>
      <PageHeader
        title="Sales CRM · Google Sheets integrations"
        description="Connect multiple Google Sheets to Sales CRM, map columns, secure webhooks, and review sync history."
      />
      <GoogleSheetsIntegrations />
    </>
  );
}
