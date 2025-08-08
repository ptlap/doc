import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../permissions/permissions';
import { isPermission } from '../permissions/permissions';

export const POLICY_KEY = 'policy:rules';

export type OwnerSelector = 'self';

export interface PolicyWhereClause {
  ownerId?: OwnerSelector; // 'self' → match current user id
}

export interface PolicyRule {
  perm: Permission;
  where?: PolicyWhereClause;
}

export interface PolicyDescriptor {
  anyOf?: PolicyRule[];
  allOf?: PolicyRule[];
}

export const Policy = (descriptor: PolicyDescriptor) =>
  SetMetadata(POLICY_KEY, descriptor);

export const isPolicyWhereClause = (
  value: unknown,
): value is PolicyWhereClause => {
  if (value === undefined) return true;
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as { ownerId?: unknown };
  if (obj.ownerId === undefined) return true;
  return obj.ownerId === 'self';
};

export const isPolicyRule = (value: unknown): value is PolicyRule => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const permOk = isPermission(v.perm);
  const whereOk = 'where' in v ? isPolicyWhereClause(v.where) : true;
  return permOk && whereOk;
};

export const isPolicyDescriptor = (
  value: unknown,
): value is PolicyDescriptor => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const anyOf = v.anyOf;
  const allOf = v.allOf;
  const anyOk =
    anyOf === undefined ||
    (Array.isArray(anyOf) && anyOf.every((r) => isPolicyRule(r)));
  const allOk =
    allOf === undefined ||
    (Array.isArray(allOf) && allOf.every((r) => isPolicyRule(r)));
  return anyOk && allOk;
};
