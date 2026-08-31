import { embeddedCatalogStats } from './lib/municipality-provider.mjs';
import { EMBEDDED_PUBLIC_PLAN_RECORDS, PUBLIC_PLAN_RECORD_VERSION } from './lib/plan-record-client.mjs';
import { OPEN_OFFICIAL_SOURCE_VERSION } from './lib/open-official-source-client.mjs';
import {
  EMBEDDED_OPEN_OFFICIAL_ZONING_RECORDS,
  OPEN_OFFICIAL_ZONING_RECORD_VERSION
} from './lib/open-official-zoning-records.mjs';
import { PLAN_AI_MODEL, PLAN_AI_VERSION } from './lib/plan-ai-client.mjs';
import { runtimeEnv, runtimePlatform } from './lib/runtime-env.mjs';

export async function handler(event, context = {}) {
  const env = runtimeEnv(context);
  const platform = runtimePlatform(context);
  const automaticZoningConfigured = EMBEDDED_OPEN_OFFICIAL_ZONING_RECORDS.length > 0 || Boolean(
    env.PLANLAMASYON_ZONING_API_URL ||
    env.EPLAN_ADAPTER_URL ||
    env.VERIFIED_ZONING_JSON ||
    env.MUNICIPALITY_CONNECTORS_JSON ||
    env.OPEN_OFFICIAL_ZONING_SOURCES_JSON
  );
  const publicPlanCoverageEnabled = String(env.PUBLIC_PLAN_COVERAGE_ENABLED ?? 'true').toLowerCase() === 'true';
  const environmentEnabled = String(env.ENVIRONMENT_ANALYSIS_ENABLED ?? 'true').toLowerCase() === 'true';
  const planAiEnabled = String(env.PLAN_AI_ENABLED ?? 'true').toLowerCase() === 'true';
  const planAiConfigured = Boolean(String(env.NVIDIA_API_KEY || '').trim());
  const accountSyncEnabled = platform !== 'cloudflare-worker' && String(env.ACCOUNT_SYNC_ENABLED || '').toLowerCase() === 'true';
  const catalog = embeddedCatalogStats();

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    },
    body: JSON.stringify({
      ok: true,
      app: 'planlamasyon-v3.8.1',
      runtime: platform,
      modules: {
        tkgm: true,
        tkgmCloudflareBridge: true,
        tkgmCloudflareNativeBridge: true,
        tkgmNetlifyOriginalClient: true,
        tkgmAdminApiV3: true,
        tkgmParcelApiV31: true,
        tkgmOfficialBrowserHeaders: true,
        zoningAdapters: true,
        automaticZoningConfigured,
        publicPlanCoverageEnabled,
        publicPlanMetadata: publicPlanCoverageEnabled,
        publicPlanRecordDiscovery: true,
        publicPlanRecordVersion: PUBLIC_PLAN_RECORD_VERSION,
        embeddedPublicPlanRecords: EMBEDDED_PUBLIC_PLAN_RECORDS.length,
        publicPlanRecordApi: '/api/plan-records',
        officialZoningDocumentReader: true,
        officialZoningDocumentParserVersion: '3.8.0',
        officialZoningDocumentApi: '/api/parse-zoning-document',
        officialZoningDocumentFormats: ['pdf', 'html', 'txt', 'json', 'xml', 'image-ocr'],
        parcelDocumentMatchGuard: true,
        openOfficialSourceScan: true,
        openOfficialSourceScanVersion: OPEN_OFFICIAL_SOURCE_VERSION,
        openOfficialSourceScanApi: '/api/open-source-scan',
        openOfficialSourceTypes: ['wms', 'wfs', 'arcgis', 'json', 'read-only-result', 'official-record', 'authorized-portal-adapter'],
        openOfficialZoningRecordVersion: OPEN_OFFICIAL_ZONING_RECORD_VERSION,
        embeddedOpenOfficialZoningRecords: EMBEDDED_OPEN_OFFICIAL_ZONING_RECORDS.length,
        manualOnlyPortalPolicy: true,
        eDevletFreeSourcePriority: true,
        documentUploadFallbackOnly: true,
        nationalMunicipalityProvider: true,
        municipalityServiceDiscovery: true,
        embeddedMunicipalityCatalog: true,
        embeddedMunicipalityCatalogVersion: catalog.version,
        embeddedMunicipalityCatalogRecords: catalog.recordCount,
        embeddedMunicipalityCatalogMunicipalRecords: catalog.municipalRecordCount,
        embeddedMunicipalityCatalogProvinceCoverage: catalog.provinceCount,
        configuredMunicipalityAdapters: Boolean(env.MUNICIPALITY_CONNECTORS_JSON),
        environment: environmentEnabled,
        environmentFailover: true,
        accounts: accountSyncEnabled,
        accountSyncEnabled,
        accountStorageMode: accountSyncEnabled ? 'authenticated-server' : 'client-local-only',
        planAi: planAiEnabled,
        planAiConfigured,
        planAiVersion: PLAN_AI_VERSION,
        planAiModel: String(env.PLAN_AI_MODEL || PLAN_AI_MODEL),
        planAiApi: '/api/plan-ai',
        planAiAutomaticOfficialSourceReading: true,
        planAiCalculationGuard: 'official-evidence+parcel-match+currentness',
        planAiAsyncStatusPolling: true,
        planAiVerifiedFallback: true,
        dualHostRuntime: true,
        cloudflarePagesFunctions: true,
        cloudflareWorkerRuntime: true,
        cloudflareRuntimeSecrets: true
      },
      catalog,
      time: new Date().toISOString()
    })
  };
}
