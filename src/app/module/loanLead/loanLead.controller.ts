import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { getAuditActor } from "../../utils/auditLogger";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { LoanLeadService } from "./loanLead.service";

const createLoanLead = catchAsync(async (req: Request, res: Response) => {
  const result = await LoanLeadService.createLoanLead(
    req.user as RequestUser,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Financing request sent successfully",
    data: result,
  });
});

const getMyLoanLeads = catchAsync(async (req: Request, res: Response) => {
  const result = await LoanLeadService.getMyLoanLeads(
    req.user as RequestUser,
    req.query,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Financing requests retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getLoanLeads = catchAsync(async (req: Request, res: Response) => {
  const result = await LoanLeadService.getLoanLeads(req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Loan leads retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getLoanLeadById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await LoanLeadService.getLoanLeadById(
    req.user as RequestUser,
    id as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Financing request retrieved successfully",
    data: result,
  });
});

const withdrawLoanLead = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await LoanLeadService.withdrawLoanLead(
    req.user as RequestUser,
    id as string,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Financing request withdrawn",
    data: result,
  });
});

const assignLoanLead = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await LoanLeadService.assignLoanLead(
    getAuditActor(req),
    id as string,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Loan lead sent to the finance partner",
    data: result,
  });
});

const updateLoanLeadStatus = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await LoanLeadService.updateLoanLeadStatus(
    getAuditActor(req),
    id as string,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Loan lead status updated",
    data: result,
  });
});

export const LoanLeadController = {
  createLoanLead,
  getMyLoanLeads,
  getLoanLeads,
  getLoanLeadById,
  withdrawLoanLead,
  assignLoanLead,
  updateLoanLeadStatus,
};
