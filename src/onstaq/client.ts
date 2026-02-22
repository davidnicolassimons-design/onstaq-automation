import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import {
  AuthResponse, AuthUser, Workspace, WorkspaceTemplate, WorkspaceMember,
  WorkspaceInvitation, WorkspaceRole, Catalog, Attribute, AttributeType,
  Cardinality, AttributeConfig, Item, ItemsListResponse, ItemFilter,
  ImportResult, ItemReference, ReferenceKind, HistoryEntry, Comment,
  BackReferences, OqlResponse, Organization, AdminUsersResponse, Pagination
} from './types';
import { logger } from '../utils/logger';

export interface OnstaqClientConfig {
  baseUrl: string;
  token?: string;
  email?: string;
  password?: string;
}

/**
 * Typed HTTP client for the ONSTAQ REST API (65 endpoints).
 * Handles authentication, token refresh, and all CRUD operations.
 */
export class OnstaqClient {
  private http: AxiosInstance;
  private token: string | null;
  private config: OnstaqClientConfig;

  constructor(config: OnstaqClientConfig) {
    this.config = config;
    this.token = config.token || null;
    this.http = axios.create({
      baseURL: config.baseUrl,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });

    // Attach auth token to every request
    this.http.interceptors.request.use((req) => {
      if (this.token) {
        req.headers.Authorization = `Bearer ${this.token}`;
      }
      return req;
    });

    // Log errors
    this.http.interceptors.response.use(
      (res) => res,
      (err) => {
        const status = err.response?.status;
        const data = err.response?.data;
        logger.error(`ONSTAQ API error [${status}]: ${JSON.stringify(data)}`);
        throw err;
      }
    );
  }

  /** Get the current auth token */
  getToken(): string | null {
    return this.token;
  }

  /** Set a new auth token (e.g., from user-provided JWT) */
  setToken(token: string): void {
    this.token = token;
  }

  // ===========================================================================
  // 1. AUTHENTICATION
  // ===========================================================================

  async login(email?: string, password?: string): Promise<AuthResponse> {
    const res = await this.http.post<AuthResponse>('/auth/login', {
      email: email || this.config.email,
      password: password || this.config.password,
    });
    this.token = res.data.token;
    return res.data;
  }

  async register(email: string, name: string, password: string): Promise<AuthResponse> {
    const res = await this.http.post<AuthResponse>('/auth/register', { email, name, password });
    return res.data;
  }

  async getMe(): Promise<AuthUser> {
    const res = await this.http.get<AuthUser>('/auth/me');
    return res.data;
  }

  async validateInvite(token: string) {
    const res = await this.http.get(`/auth/invite/${token}`);
    return res.data;
  }

  async registerWithInvite(token: string, name: string, password: string): Promise<AuthResponse> {
    const res = await this.http.post<AuthResponse>('/auth/register-with-invite', { token, name, password });
    return res.data;
  }

  // ===========================================================================
  // 2. USERS
  // ===========================================================================

  async listUsers(): Promise<AuthUser[]> {
    const res = await this.http.get<AuthUser[]>('/users');
    return res.data;
  }

  async getUser(id: string) {
    const res = await this.http.get(`/users/${id}`);
    return res.data;
  }

  // ===========================================================================
  // 3. WORKSPACES
  // ===========================================================================

  async listTemplates(): Promise<WorkspaceTemplate[]> {
    const res = await this.http.get<WorkspaceTemplate[]>('/workspaces/templates');
    return res.data;
  }

  async createFromTemplate(templateId: string, name: string, key: string): Promise<Workspace> {
    const res = await this.http.post<Workspace>('/workspaces/from-template', { templateId, name, key });
    return res.data;
  }

  async importWorkspace(data: any): Promise<Workspace> {
    const res = await this.http.post<Workspace>('/workspaces/import', data);
    return res.data;
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const res = await this.http.get<Workspace[]>('/workspaces');
    return res.data;
  }

  async getWorkspace(id: string): Promise<Workspace> {
    const res = await this.http.get<Workspace>(`/workspaces/${id}`);
    return res.data;
  }

  async createWorkspace(data: { name: string; key: string; description?: string; allowCrossWorkspaceRefs?: boolean }): Promise<Workspace> {
    const res = await this.http.post<Workspace>('/workspaces', data);
    return res.data;
  }

  async updateWorkspace(id: string, data: Partial<Pick<Workspace, 'name' | 'description' | 'icon' | 'allowCrossWorkspaceRefs'>>): Promise<Workspace> {
    const res = await this.http.put<Workspace>(`/workspaces/${id}`, data);
    return res.data;
  }

  async deleteWorkspace(id: string): Promise<void> {
    await this.http.delete(`/workspaces/${id}`);
  }

  async exportWorkspace(id: string): Promise<any> {
    const res = await this.http.get(`/workspaces/${id}/export`);
    return res.data;
  }

  async cloneWorkspace(id: string, name: string, key: string): Promise<Workspace> {
    const res = await this.http.post<Workspace>(`/workspaces/${id}/clone`, { name, key });
    return res.data;
  }

  async getMyWorkspaceRole(workspaceId: string): Promise<{ role: WorkspaceRole | null }> {
    const res = await this.http.get(`/workspaces/${workspaceId}/my-role`);
    return res.data;
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const res = await this.http.get<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`);
    return res.data;
  }

  async addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<WorkspaceMember> {
    const res = await this.http.post<WorkspaceMember>(`/workspaces/${workspaceId}/members`, { userId, role });
    return res.data;
  }

  async updateMemberRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<WorkspaceMember> {
    const res = await this.http.put<WorkspaceMember>(`/workspaces/${workspaceId}/members/${userId}`, { role });
    return res.data;
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await this.http.delete(`/workspaces/${workspaceId}/members/${userId}`);
  }

  async listAvailableUsers(workspaceId: string, search?: string): Promise<AuthUser[]> {
    const params: any = {};
    if (search) params.search = search;
    const res = await this.http.get<AuthUser[]>(`/workspaces/${workspaceId}/available-users`, { params });
    return res.data;
  }

  async inviteToWorkspace(workspaceId: string, email: string, role: WorkspaceRole) {
    const res = await this.http.post(`/workspaces/${workspaceId}/invite`, { email, role });
    return res.data;
  }

  async listInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
    const res = await this.http.get<WorkspaceInvitation[]>(`/workspaces/${workspaceId}/invitations`);
    return res.data;
  }

  async revokeInvitation(workspaceId: string, invitationId: string): Promise<void> {
    await this.http.delete(`/workspaces/${workspaceId}/invitations/${invitationId}`);
  }

  // ===========================================================================
  // 4. CATALOGS
  // ===========================================================================

  async listCatalogs(workspaceId: string): Promise<Catalog[]> {
    const res = await this.http.get<Catalog[]>('/catalogs', { params: { workspaceId } });
    return res.data;
  }

  async getCatalog(id: string): Promise<Catalog> {
    const res = await this.http.get<Catalog>(`/catalogs/${id}`);
    return res.data;
  }

  async createCatalog(data: {
    workspaceId: string;
    name: string;
    description?: string;
    icon?: string;
    position?: number;
    isAbstract?: boolean;
    parentTypeId?: string;
  }): Promise<Catalog> {
    const res = await this.http.post<Catalog>('/catalogs', data);
    return res.data;
  }

  async updateCatalog(id: string, data: Partial<Pick<Catalog, 'name' | 'description' | 'icon' | 'position' | 'isAbstract' | 'parentTypeId'>>): Promise<Catalog> {
    const res = await this.http.put<Catalog>(`/catalogs/${id}`, data);
    return res.data;
  }

  async deleteCatalog(id: string): Promise<void> {
    await this.http.delete(`/catalogs/${id}`);
  }

  // ===========================================================================
  // 5. ATTRIBUTES
  // ===========================================================================

  async listAttributes(catalogId: string): Promise<Attribute[]> {
    const res = await this.http.get<Attribute[]>('/attributes', { params: { catalogId } });
    return res.data;
  }

  async getAttribute(id: string): Promise<Attribute> {
    const res = await this.http.get<Attribute>(`/attributes/${id}`);
    return res.data;
  }

  async createAttribute(data: {
    catalogId: string;
    name: string;
    type: AttributeType;
    description?: string;
    position?: number;
    isRequired?: boolean;
    isUnique?: boolean;
    isLabel?: boolean;
    isEditable?: boolean;
    defaultValue?: any;
    cardinality?: Cardinality;
    config?: AttributeConfig;
  }): Promise<Attribute> {
    const res = await this.http.post<Attribute>('/attributes', data);
    return res.data;
  }

  async updateAttribute(id: string, data: Partial<{
    name: string;
    type: AttributeType;
    description: string;
    position: number;
    isRequired: boolean;
    isUnique: boolean;
    isLabel: boolean;
    isEditable: boolean;
    defaultValue: any;
    cardinality: Cardinality;
    config: AttributeConfig;
  }>): Promise<Attribute> {
    const res = await this.http.put<Attribute>(`/attributes/${id}`, data);
    return res.data;
  }

  async deleteAttribute(id: string): Promise<void> {
    await this.http.delete(`/attributes/${id}`);
  }

  // ===========================================================================
  // 6. ITEMS
  // ===========================================================================

  async listItems(params: {
    catalogId?: string;
    workspaceId?: string;
    search?: string;
    key?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    filters?: ItemFilter[];
  }): Promise<ItemsListResponse> {
    const query: any = { ...params };
    if (params.filters) {
      query.filters = JSON.stringify(params.filters);
    }
    const res = await this.http.get<ItemsListResponse>('/items', { params: query });
    return res.data;
  }

  async getItem(id: string): Promise<Item> {
    const res = await this.http.get<Item>(`/items/${id}`);
    return res.data;
  }

  async createItem(catalogId: string, attributes?: Record<string, any>): Promise<Item> {
    const res = await this.http.post<Item>('/items', { catalogId, attributes });
    return res.data;
  }

  async updateItem(id: string, attributes: Record<string, any>, extra?: { status?: string | null }): Promise<Item> {
    const res = await this.http.put<Item>(`/items/${id}`, { attributes, ...extra });
    return res.data;
  }

  async deleteItem(id: string): Promise<void> {
    await this.http.delete(`/items/${id}`);
  }

  async importItems(catalogId: string, rows: Record<string, any>[], keyColumn?: string): Promise<ImportResult> {
    const res = await this.http.post<ImportResult>('/items/import', { catalogId, rows, keyColumn });
    return res.data;
  }

  // --- Item References ---

  async getBackReferences(itemId: string): Promise<BackReferences> {
    const res = await this.http.get<BackReferences>(`/items/${itemId}/back-references`);
    return res.data;
  }

  async getReferences(itemId: string): Promise<{ outbound: ItemReference[]; inbound: ItemReference[] }> {
    const res = await this.http.get(`/items/${itemId}/references`);
    return res.data;
  }

  async createReference(itemId: string, toItemId: string, referenceKind?: ReferenceKind, label?: string): Promise<ItemReference> {
    const res = await this.http.post<ItemReference>(`/items/${itemId}/references`, {
      toItemId,
      referenceKind: referenceKind || 'LINK',
      label,
    });
    return res.data;
  }

  async deleteReference(itemId: string, referenceId: string): Promise<void> {
    await this.http.delete(`/items/${itemId}/references/${referenceId}`);
  }

  // --- History ---

  async getHistory(itemId: string): Promise<HistoryEntry[]> {
    const res = await this.http.get<HistoryEntry[]>(`/items/${itemId}/history`);
    return res.data;
  }

  // --- Comments ---

  async getComments(itemId: string): Promise<Comment[]> {
    const res = await this.http.get<Comment[]>(`/items/${itemId}/comments`);
    return res.data;
  }

  async addComment(itemId: string, body: string): Promise<Comment> {
    const res = await this.http.post<Comment>(`/items/${itemId}/comments`, { body });
    return res.data;
  }

  // ===========================================================================
  // 7. ADMIN
  // ===========================================================================

  async adminListUsers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    role?: 'ADMIN' | 'USER';
    isActive?: string;
    organizationId?: string;
  }): Promise<AdminUsersResponse> {
    const res = await this.http.get<AdminUsersResponse>('/admin/users', { params });
    return res.data;
  }

  async adminCreateUser(data: { email: string; name: string; password: string; role?: 'ADMIN' | 'USER'; organizationId?: string }) {
    const res = await this.http.post('/admin/users', data);
    return res.data;
  }

  async adminUpdateUser(id: string, data: Partial<{ name: string; role: string; isActive: boolean; organizationId: string }>) {
    const res = await this.http.put(`/admin/users/${id}`, data);
    return res.data;
  }

  async adminDeleteUser(id: string): Promise<void> {
    await this.http.delete(`/admin/users/${id}`);
  }

  async adminResetPassword(id: string, newPassword: string): Promise<void> {
    await this.http.post(`/admin/users/${id}/reset-password`, { newPassword });
  }

  async adminForceLogout(id: string): Promise<void> {
    await this.http.post(`/admin/users/${id}/force-logout`);
  }

  async adminListOrganizations(): Promise<Organization[]> {
    const res = await this.http.get<Organization[]>('/admin/organizations');
    return res.data;
  }

  async adminGetOrganization(id: string): Promise<Organization> {
    const res = await this.http.get<Organization>(`/admin/organizations/${id}`);
    return res.data;
  }

  async adminCreateOrganization(name: string, description?: string): Promise<Organization> {
    const res = await this.http.post<Organization>('/admin/organizations', { name, description });
    return res.data;
  }

  async adminUpdateOrganization(id: string, data: Partial<{ name: string; description: string }>): Promise<Organization> {
    const res = await this.http.put<Organization>(`/admin/organizations/${id}`, data);
    return res.data;
  }

  async adminDeleteOrganization(id: string): Promise<void> {
    await this.http.delete(`/admin/organizations/${id}`);
  }

  async adminAddOrgMembers(orgId: string, userIds: string[]): Promise<Organization> {
    const res = await this.http.post<Organization>(`/admin/organizations/${orgId}/members`, { userIds });
    return res.data;
  }

  async adminRemoveOrgMember(orgId: string, userId: string): Promise<void> {
    await this.http.delete(`/admin/organizations/${orgId}/members/${userId}`);
  }

  async adminLinkWorkspace(orgId: string, workspaceId: string, defaultRole?: WorkspaceRole): Promise<void> {
    await this.http.post(`/admin/organizations/${orgId}/workspaces`, { workspaceId, defaultRole });
  }

  async adminUnlinkWorkspace(orgId: string, workspaceId: string): Promise<void> {
    await this.http.delete(`/admin/organizations/${orgId}/workspaces/${workspaceId}`);
  }

  // ===========================================================================
  // 8. OQL
  // ===========================================================================

  async executeOql(query: string, workspaceId: string): Promise<OqlResponse> {
    const res = await this.http.post<OqlResponse>('/oql', { query, workspaceId });
    return res.data;
  }

  // ===========================================================================
  // HEALTH
  // ===========================================================================

  async health(): Promise<{ status: string }> {
    const res = await this.http.get('/health');
    return res.data;
  }

  // ===========================================================================
  // UTILITY: Get full workspace schema (catalogs + attributes)
  // ===========================================================================

  async getWorkspaceSchema(workspaceId: string): Promise<{ workspace: Workspace; catalogs: (Catalog & { allAttributes: Attribute[] })[] }> {
    const workspace = await this.getWorkspace(workspaceId);
    const catalogs = await this.listCatalogs(workspaceId);

    const enriched = await Promise.all(
      catalogs.map(async (cat) => {
        const full = await this.getCatalog(cat.id);
        return { ...full, allAttributes: full.allAttributes || full.attributes || [] };
      })
    );

    return { workspace, catalogs: enriched };
  }
}
