import type { Permission, RoleCode } from '@sisurat/shared';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  position: string | null;
  unitId: string | null;
  roles: RoleCode[];
  permissions: Set<Permission>;
  mustChangePassword: boolean;
}

/** Who performed an action and from where — passed into services for audit logging. */
export interface ActionContext {
  user: AuthUser;
  ip?: string;
  userAgent?: string;
}

/** Context for system actions (worker, scheduler). */
export interface SystemContext {
  user?: undefined;
  ip?: undefined;
  userAgent?: undefined;
  system: string;
}
