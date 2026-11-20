import { ReportReason, ReportStatus, ReportTargetType } from "../../../generated/prisma/enums";

export const REPORT_ACTIONS = ["NONE", "TAKE_DOWN_LISTING", "BLOCK_USER", "HIDE_REVIEW"] as const;

export type TReportAction = (typeof REPORT_ACTIONS)[number];

export interface ICreateReportPayload {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string;
}

export interface IUpdateReportPayload {
  status: Extract<ReportStatus, "IN_REVIEW" | "RESOLVED" | "DISMISSED">;
  resolutionNote?: string;
  action?: TReportAction;
}
