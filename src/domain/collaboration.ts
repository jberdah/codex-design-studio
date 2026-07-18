export type CollaborationCapability = "encrypted-sync" | "sharing" | "roles" | "audit-history" | "conflict-resolution";
export type CollaborationRole = "owner" | "editor" | "commenter" | "viewer";

export interface CollaborationMember {
  subjectId: string;
  displayName: string;
  role: CollaborationRole;
  grantedBy: string;
  grantedAt: string;
  revokedAt?: string;
}

export interface CollaborationAuditEvent {
  id: string;
  sequence: number;
  at: string;
  actor: string;
  action: string;
  detail: Record<string, string | number | boolean>;
  previousHash: string | null;
  hash: string;
}

export interface CollaborationConflict {
  id: string;
  artifactId: string;
  baseHash: string;
  localHash: string;
  remoteHash: string;
  status: "open" | "resolved";
  createdAt: string;
  resolution?: "local" | "remote" | "merged";
  resolvedHash?: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface CollaborationRegistry {
  schemaVersion: 1;
  projectId: string;
  mode: "local-only" | "encrypted-sync";
  capabilities: Record<CollaborationCapability, boolean>;
  members: CollaborationMember[];
  audit: CollaborationAuditEvent[];
  conflicts: CollaborationConflict[];
  updatedAt: string;
}

export interface EncryptedSyncEnvelope {
  schemaVersion: 1;
  projectId: string;
  cipher: "aes-256-gcm";
  kdf: "scrypt";
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  plaintextHash: string;
  createdAt: string;
}

