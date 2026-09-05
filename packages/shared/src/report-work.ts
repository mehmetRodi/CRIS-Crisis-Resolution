import { isTerminalStatus, ReportStatus, UserRole } from './domain';

export const WorkAction = {
  CLAIM: 'CLAIM',
  ASSIGN: 'ASSIGN',
  RELEASE: 'RELEASE',
  NOTE: 'NOTE',
} as const;
export type WorkAction = (typeof WorkAction)[keyof typeof WorkAction];
export const WORK_NOTE_MAX_LENGTH = 2000;
export interface WorkUpdate {
  id: string;
  text: string;
  authorLabel: string;
  createdAt: string;
}
export interface ReportWorkView {
  reportId: string;
  version: number;
  assigneeLabel: string | null;
  isMine: boolean;
  canClaim: boolean;
  canEdit: boolean;
  updates: WorkUpdate[];
}
export function canCoordinateWork(role: UserRole): boolean {
  return role === UserRole.COORDINATOR || role === UserRole.ADMIN;
}
export function canClaimReport(status: ReportStatus): boolean {
  return status === ReportStatus.VERIFIED || status === ReportStatus.IN_PROGRESS;
}
export function isWorkReadOnly(status: ReportStatus): boolean {
  return status === ReportStatus.RESOLVED || isTerminalStatus(status);
}
