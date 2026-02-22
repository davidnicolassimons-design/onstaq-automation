// =============================================================================
// ONSTAQ API Type Definitions
// Complete TypeScript types for the ONSTAQ REST API
// =============================================================================

// --- Authentication ---

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'USER';
  isActive?: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
}

export interface InviteInfo {
  email: string;
  role: WorkspaceRole;
  workspace: { id: string; name: string };
  expiresAt: string;
}

// --- Workspaces ---

export type WorkspaceRole = 'WORKSPACE_ADMIN' | 'ITEM_EDITOR' | 'ITEM_VIEWER';

export interface Workspace {
  id: string;
  name: string;
  key: string;
  description?: string;
  icon?: string;
  allowCrossWorkspaceRefs: boolean;
  createdAt: string;
  updatedAt: string;
  catalogs?: Catalog[];
  itemCount?: number;
  _count?: { catalogs: number };
}

export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  suggestedKey: string;
  suggestedName: string;
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  globalRole: string;
  workspaceRole: WorkspaceRole;
  createdAt: string;
}

export interface WorkspaceInvitation {
  id: string;
  email: string;
  role: WorkspaceRole;
  token: string;
  expiresAt: string;
  invitedBy: string;
}

// --- Catalogs ---

export interface Catalog {
  id: string;
  name: string;
  description?: string;
  icon: string;
  position: number;
  isAbstract: boolean;
  workspaceId: string;
  parentTypeId?: string;
  attributes?: Attribute[];
  childTypes?: Catalog[];
  parentType?: Catalog;
  inheritedAttributes?: (Attribute & { inherited: boolean; inheritedFrom: string })[];
  allAttributes?: Attribute[];
  _count?: { items: number; childTypes: number; attributes: number };
}

// --- Attributes ---

export type AttributeType =
  | 'TEXT' | 'TEXTAREA' | 'INTEGER' | 'FLOAT' | 'BOOLEAN'
  | 'DATE' | 'DATETIME' | 'EMAIL' | 'URL'
  | 'SELECT' | 'MULTI_SELECT' | 'STATUS'
  | 'ITEM_REFERENCE' | 'USER' | 'GROUP'
  | 'ATTACHMENT' | 'IP_ADDRESS';

export type Cardinality = 'SINGLE' | 'MULTI';

export interface AttributeConfig {
  options?: string[];
  referenceCatalogId?: string;
}

export interface Attribute {
  id: string;
  name: string;
  type: AttributeType;
  description?: string;
  position: number;
  isRequired: boolean;
  isUnique: boolean;
  isLabel: boolean;
  isEditable: boolean;
  defaultValue?: any;
  cardinality: Cardinality;
  config?: AttributeConfig;
  catalogId: string;
}

// --- Items ---

export interface Item {
  id: string;
  key: string;
  label?: string;
  catalogId: string;
  catalog?: {
    id: string;
    name: string;
    icon?: string;
    workspaceId: string;
    workspace?: Workspace;
  };
  attributeValues: Record<string, any>;
  resolvedReferences?: Record<string, { id: string; key: string; label: string }>;
  allAttributes?: Attribute[];
  outboundReferences?: ItemReference[];
  inboundReferences?: ItemReference[];
  createdBy?: { id: string; name: string; email: string };
  updatedBy?: { id: string; name: string; email: string };
  createdAt: string;
  updatedAt: string;
}

export interface ItemReference {
  id: string;
  fromItemId: string;
  toItemId: string;
  referenceKind: ReferenceKind;
  label?: string;
  toItem?: Item;
  fromItem?: Item;
}

export type ReferenceKind = 'DEPENDENCY' | 'INSTALLED' | 'LINK' | 'OWNERSHIP' | 'LOCATED_IN' | 'CUSTOM';

export interface ItemsListResponse {
  data: Item[];
  resolvedReferences: Record<string, { id: string; key: string; label: string }>;
  pagination: Pagination;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ItemFilter {
  attributeId: string;
  operator: 'contains' | 'equals';
  value: any;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  total: number;
  results: {
    rowIndex: number;
    status: 'created' | 'updated' | 'skipped';
    key?: string;
    error?: string;
  }[];
}

// --- History ---

export type HistoryAction = 'CREATED' | 'UPDATED' | 'REFERENCE_ADDED' | 'REFERENCE_REMOVED';

export interface HistoryEntry {
  id: string;
  itemId: string;
  userId: string;
  action: HistoryAction;
  changes: Record<string, any>;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

// --- Comments ---

export interface Comment {
  id: string;
  itemId: string;
  userId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string; email: string };
}

// --- Back References ---

export interface BackReferences {
  [catalogName: string]: {
    icon: string;
    catalogId: string;
    workspaceId: string;
    items: {
      id: string;
      key: string;
      label: string;
      attributeName: string;
    }[];
  };
}

// --- OQL ---

export interface OqlColumn {
  name: string;
  type: string;
  sourceAttribute?: string;
}

export interface OqlResponse {
  columns: OqlColumn[];
  rows: Record<string, any>[];
  totalCount: number;
  executionTimeMs: number;
  query: string;
  warnings: string[];
}

export interface OqlError {
  error: {
    code: string;
    message: string;
    details?: {
      position: number;
      line: number;
      column: number;
    };
  };
}

// --- Admin ---

export interface Organization {
  id: string;
  name: string;
  description?: string;
  members?: AuthUser[];
  workspaces?: Workspace[];
  _count?: { members: number; workspaces: number };
}

export interface AdminUsersResponse {
  data: (AuthUser & { organization?: Organization })[];
  pagination: Pagination;
}
