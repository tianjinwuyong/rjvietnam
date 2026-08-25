/**
 * PermissionGuard — conditionally render children or a fallback based on permissions.
 * Usage: <PermissionGuard permission="lifecycle.edit" permissions={permissions}>
 *          {editButton}
 *        </PermissionGuard>
 *        <PermissionGuard permission="lifecycle.approve" permissions={permissions} fallback={null}>
 *          {approveButton}
 *        </PermissionGuard>
 */
import React from "react";

interface PermissionGuardProps {
  permission: string;
  permissions: string[];
  children: React.ReactNode;
  /** React node to render when denied. Default = null (renders nothing) */
  fallback?: React.ReactNode;
}

export function PermissionGuard({ permission, permissions, children, fallback = null }: PermissionGuardProps) {
  if (!permissions.includes(permission)) return <>{fallback}</>;
  return <>{children}</>;
}
