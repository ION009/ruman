export interface ControlPlaneViewer {
  id: string;
  email: string;
  fullName: string;
}

export interface ControlPlaneSite {
  id: string;
  name: string;
  slug: string;
  origins: string[];
  role: string;
}

export interface ControlPlaneSession {
  sessionId: string;
  user: ControlPlaneViewer;
}

export interface SiteRegistrationInput {
  name?: string;
  origin?: string;
  domain?: string;
}

export interface ControlPlaneTrackerScript {
  siteId: string;
  installOrigin: string;
  collectorOrigin: string;
  scriptSrc: string;
  scriptTag: string;
  isPersisted: boolean;
  updatedAt?: string | null;
}

export interface ControlPlaneSiteTrackingSettings {
  blockBotTrafficEnabled: boolean;
  domSnapshotsEnabled: boolean;
  visitorCookieEnabled: boolean;
  replayMaskTextEnabled: boolean;
  spaTrackingEnabled: boolean;
  errorTrackingEnabled: boolean;
  performanceTrackingEnabled: boolean;
}

export interface ControlPlaneSitePrivacySettings {
  domSnapshotsEnabled: boolean;
  visitorCookieEnabled: boolean;
}

export interface ControlPlaneSiteRetentionSettings {
  eventsDays: number | null;
  heatmapDays: number | null;
  replayDays: number | null;
  insightsDays: number | null;
}

export interface ControlPlaneSiteImportDefaults {
  mapping: Record<string, string>;
  timezone: string;
}

export interface ControlPlaneSiteSettings {
  tracking: ControlPlaneSiteTrackingSettings;
  retention: ControlPlaneSiteRetentionSettings;
  importDefaults: ControlPlaneSiteImportDefaults;
}
