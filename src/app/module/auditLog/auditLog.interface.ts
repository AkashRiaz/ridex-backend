import { IQuery } from "../../interfaces";

export interface IAuditLogQuery extends IQuery {
  action?: string;
  entity?: string;
  entityId?: string;
  userId?: string;
  // local dates, "YYYY-MM-DD" (to is inclusive)
  from?: string;
  to?: string;
}
