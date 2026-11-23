import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { LoanLeadController } from "./loanLead.controller";
import { LOAN_LEAD_ADMIN_ROLES, LOAN_LEAD_ROLES } from "./loanLead.utils";
import {
  AssignLoanLeadZodSchema,
  CreateLoanLeadZodSchema,
  UpdateLoanLeadStatusZodSchema,
  WithdrawLoanLeadZodSchema,
} from "./loanLead.validation";

const router = Router();

router.post(
  "/",
  auth(...LOAN_LEAD_ROLES),
  validateRequest(CreateLoanLeadZodSchema),
  LoanLeadController.createLoanLead,
);

router.get(
  "/",
  auth(...LOAN_LEAD_ADMIN_ROLES),
  LoanLeadController.getLoanLeads,
);

router.get("/my", auth(...LOAN_LEAD_ROLES), LoanLeadController.getMyLoanLeads);

// the buyer's own request, or any request for admins
router.get(
  "/:id",
  auth(...LOAN_LEAD_ROLES, ...LOAN_LEAD_ADMIN_ROLES),
  LoanLeadController.getLoanLeadById,
);

router.patch(
  "/:id/withdraw",
  auth(...LOAN_LEAD_ROLES),
  validateRequest(WithdrawLoanLeadZodSchema),
  LoanLeadController.withdrawLoanLead,
);

router.patch(
  "/:id/assign",
  auth(...LOAN_LEAD_ADMIN_ROLES),
  validateRequest(AssignLoanLeadZodSchema),
  LoanLeadController.assignLoanLead,
);

router.patch(
  "/:id/status",
  auth(...LOAN_LEAD_ADMIN_ROLES),
  validateRequest(UpdateLoanLeadStatusZodSchema),
  LoanLeadController.updateLoanLeadStatus,
);

export const LoanLeadRoutes = router;
