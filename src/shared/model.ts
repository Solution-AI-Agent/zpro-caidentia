export type Role =
  | "buyer"
  | "designer"
  | "quality"
  | "approver"
  | "admin"
  | "supplier";
export type SupplierKey = "A" | "B";
export type ReviewState = "pending" | "reviewing" | "approved" | "rejected";
export interface Actor {
  id: string;
  name: string;
  email: string;
  org: string;
  tenant: string;
  roles: Role[];
  supplier?: SupplierKey;
  active: boolean;
}
export interface Review {
  state: ReviewState;
  evidence: string;
  actor?: string;
  at?: string;
}
export interface Configuration {
  revision: number;
  requirementRevision: number;
  bomRevision: number;
  state: "reviewing" | "approved";
  technical: Review;
  quality: Review;
  ruleVersion: string;
  policyRevision: number;
}
export interface Proposal {
  id: string;
  revision: number;
  requestRevision: number;
  kind: "offer" | "counter";
  author: string;
  quantity: number;
  minQuantity: number;
  unitPriceCents: number;
  availableAt: string;
  validUntil: string;
  voltage: number;
  outputW: number;
  configRevision: number;
  note: string;
  createdAt: string;
}
export interface Commitment {
  revision: number;
  status: "submitted" | "confirmed" | "withdrawn";
  quantity: number;
  availableAt: string;
  proposalId: string;
  at: string;
  confirmedBy?: string;
}
export interface Collaboration {
  key: SupplierKey;
  org: string;
  name: string;
  revision: number;
  request: {
    revision: number;
    published: boolean;
    quantity: number;
    specification: string;
    requirement: Project["requirement"];
  };
  publicConfiguration: Configuration;
  configurations: Configuration[];
  proposals: Proposal[];
  commitments: Commitment[];
  otherAllocation: number;
  otherProject: string;
}
export interface AwardLine {
  supplier: SupplierKey;
  quantity: number;
  proposalId: string;
  configRevision: number;
  commitmentRevision: number;
  unitPriceCents: number;
}
export interface Award {
  id: string;
  state: "requested" | "approved" | "rejected";
  lines: AwardLine[];
  createdBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  published: SupplierKey[];
  handedOffAt?: string;
  reason?: string;
  snapshot?: unknown;
}
export interface Message {
  id: string;
  channel: SupplierKey | "internal";
  author: string;
  text: string;
  at: string;
}
export interface Activity {
  id: string;
  title: string;
  action: string;
  actor: string;
  channel: SupplierKey | "internal";
  at: string;
  reference: string;
}
export interface BomMapping {
  id: string;
  revision: number;
  name: string;
  columns: Record<string, string>;
  unitMap: Record<string, string>;
  visibleColumns: string[];
  sharedFields: string[];
  required: string[];
}
export interface BomRow {
  occurrence: string;
  parent: string;
  part: string;
  revision: string;
  name: string;
  quantity: number;
  unit: string;
  configuration: string;
  category: string;
  attributes: Record<string, string | number>;
}
export interface Project {
  id: string;
  tenant: string;
  name: string;
  version: number;
  target: number;
  targetDate: string;
  requirement: {
    id: string;
    revision: number;
    title: string;
    voltage: number;
    outputW: number;
    published: boolean;
  };
  bomRevision: number;
  bomCount: number;
  suppliers: Record<SupplierKey, Collaboration>;
  awards: Award[];
  messages: Message[];
  activities: Activity[];
  extension: {
    name: string;
    version: string;
    enabled: boolean;
    revision: number;
    minOutputW: number;
  };
  mappings: BomMapping[];
  shortageOwner: string;
  revokedActors: string[];
}
export interface Readiness {
  ready: boolean;
  reasons: string[];
  rule: "passed" | "failed" | "unknown";
  available: number;
  assigned: number;
  overallocated: number;
  capacity: number;
}
export interface SupplierView {
  key: SupplierKey;
  name: string;
  revision: number;
  request: Collaboration["request"];
  configuration: Configuration;
  proposals: Array<
    Omit<Proposal, "unitPriceCents"> & { unitPriceCents?: number }
  >;
  commitment?: Commitment;
  readiness?: Readiness;
  publishedAwards: Array<
    Omit<AwardLine, "supplier" | "unitPriceCents"> & {
      id: string;
      at: string;
      unitPriceCents?: number;
    }
  >;
}
export interface Workspace {
  id: string;
  name: string;
  version: number;
  tenant: string;
  actor: Actor;
  target?: number;
  targetDate: string;
  requirement: Project["requirement"];
  bomRevision: number;
  bomCount?: number;
  suppliers: SupplierView[];
  metrics?: {
    coverage: number;
    selected: number;
    shortage: number;
    unselected: number;
    overallocated: number;
  };
  awards?: Award[];
  messages: Message[];
  activities: Activity[];
  shortageOwner?: string;
  extension?: Project["extension"];
  mappings?: BomMapping[];
  actions: string[];
}
export interface Command {
  action: string;
  expectedVersion: number;
  requestId: string;
  payload: Record<string, unknown>;
}
export const roleLabels: Record<Role, string> = {
  buyer: "구매",
  designer: "설계·기술",
  quality: "품질",
  approver: "선정 승인",
  admin: "설정 관리",
  supplier: "공급사",
};
export const reviewLabels: Record<ReviewState, string> = {
  pending: "미검토",
  reviewing: "검토 중",
  approved: "승인",
  rejected: "반려",
};
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
