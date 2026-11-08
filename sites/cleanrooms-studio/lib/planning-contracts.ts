/** Wire contracts used by the authenticated storage bridge. Runtime authority stays on the server. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type PlanningKind = 'series' | 'shift' | 'week';
export interface PlanningChange {
  kind: PlanningKind;
  id: string;
  expectedVersion: number;
  value: JsonObject | null;
}
export interface PlanningDependencies {
  series: Array<{ id: string; expectedVersion: number }>;
  groups: Array<{ id: string; signature: string }>;
}
export interface PlanningWriteEnvelope {
  version: 1;
  changes: PlanningChange[];
  metadataChanged: boolean;
  metadataBase: string;
  dependencies: PlanningDependencies;
}
export interface CalendarProjection {
  mode: 'calendar';
  from: string;
  to: string;
}
export interface PlanningRange {from: string; to: string;}
export interface SeriesListProjection {
  mode: 'series-list';
  calendar: PlanningRange;
  /** Read-only catalog; does not cover the accompanying calendar. */
  catalogOnly?: true;
}
export interface SeriesProjection {
  mode: 'series';
  seriesId?: string;
  groupId?: string;
  ranges: PlanningRange[];
  calendar: PlanningRange;
}
export interface PublicationProjection {
  mode: 'publication';
  from: string;
  to: string;
  siteIds: number[];
  includeDependencies: boolean;
  calendar: PlanningRange;
}
export type PlanningProjection = CalendarProjection | SeriesListProjection | SeriesProjection | PublicationProjection;
export interface StorageReadMessage {
  id: string | number;
  action: 'read';
  projection?: PlanningProjection;
  cursor?: string;
  instructions?: 'deferred';
}
export interface PlanningReceipt {
  schema: 1;
  versions: Record<string, number>;
  metadataHash: string;
  /** Absence generation pinned when calendar weeks are merged in the client. */
  absenceVersion?: number;
  /** Collector-only original ordering of the bounded working set. */
  recordOrder?: Record<string, number>;
  /** Server index geometry for lossless splitting of complete calendar batches. */
  recordWindows?: Record<string, {from: string | null; to: string | null; origin: string | null; parent: string | null}>;
  partial?: boolean;
  projection?: PlanningProjection;
  /** Compact record keys whose instruction bodies have not been loaded. */
  deferred?: string[];
  instructions?: 'deferred';
}
export interface StudioWriteRequest {
  revision: number;
  studio: JsonObject;
  planning?: PlanningWriteEnvelope;
  commandReceipt?: 'records';
  directoryRevision?: number;
  publication?: JsonObject;
  projection?: PlanningProjection;
  instructions?: 'deferred';
}
export interface StorageWriteMessage extends StudioWriteRequest {
  id: string | number;
  action: 'write';
}
/** Exact committed rows; untouched client versions remain observations, not new authority. */
export interface PlanningRecordPatch {
  kind: PlanningKind;
  id: string;
  value: JsonObject | null;
  version: number;
  sortOrder?: number;
}
/** Point reads are fenced by the calendar's observed plan and directory generations. */
export interface PlannerDetailReadPayload {
  revision: number;
  directoryRevision: number;
  shiftIds: string[];
  seriesIds?: string[];
}
export interface PlannerDetailReadResponse {
  revision: number;
  directoryRevision: number;
  records: PlanningRecordPatch[];
  planning: PlanningReceipt;
  detailShifts: JsonObject[];
  progress: JsonObject;
}
export interface PlanningPatchAcknowledgment {
  revision: number;
  recordPatch: true;
  reconciledRecords: PlanningRecordPatch[];
  planning: PlanningReceipt;
  requiresRefresh?: boolean;
}
export type DirectoryKind = 'employee' | 'site' | 'department';
export interface DirectoryReadPayload {kind?: DirectoryKind; ids?: string[]; cursor?: string; limit?: number; catalog?: boolean;}
export interface DirectoryChange {kind: DirectoryKind; id: string; expectedVersion: number; patch: JsonObject; siteIndex?: number;}
export interface DirectoryWritePayload {changes: DirectoryChange[];}
export interface DirectoryRecord {kind: DirectoryKind; id: string; version: number; position?: number; siteIndex?: number; value: JsonObject;}
export interface DirectoryReceipt {schema: 1; revision: number; nextSiteIndex?: number; complete?: boolean; versions?: Record<string, number>;}
export type StorageDirectoryMessage = {action:'directoryRead';payload:DirectoryReadPayload}|{action:'directoryWrite';payload:DirectoryWritePayload};
