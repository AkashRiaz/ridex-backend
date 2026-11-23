import { Router } from "express";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { LOAN_LEAD_ADMIN_ROLES } from "../loanLead/loanLead.utils";
import { FinancePartnerController } from "./financePartner.controller";
import {
  CreateFinancePartnerZodSchema,
  UpdateFinancePartnerZodSchema,
} from "./financePartner.validation";

const router = Router();

router.post(
  "/",
  auth(...LOAN_LEAD_ADMIN_ROLES),
  upload.fields([{ name: "logo", maxCount: 1 }]),
  validateRequest(CreateFinancePartnerZodSchema),
  FinancePartnerController.createFinancePartner,
);

router.get(
  "/",
  auth(...LOAN_LEAD_ADMIN_ROLES),
  FinancePartnerController.getAllFinancePartners,
);

// public: rates and limits only (EMI calculator)
router.get("/active", FinancePartnerController.getActiveFinancePartners);

router.get(
  "/:id",
  auth(...LOAN_LEAD_ADMIN_ROLES),
  FinancePartnerController.getFinancePartnerById,
);

router.patch(
  "/:id",
  auth(...LOAN_LEAD_ADMIN_ROLES),
  upload.fields([{ name: "logo", maxCount: 1 }]),
  validateRequest(UpdateFinancePartnerZodSchema),
  FinancePartnerController.updateFinancePartner,
);

router.delete(
  "/:id",
  auth(...LOAN_LEAD_ADMIN_ROLES),
  FinancePartnerController.deleteFinancePartner,
);

export const FinancePartnerRoutes = router;
