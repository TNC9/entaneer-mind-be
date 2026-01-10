import { Request, Response, NextFunction } from 'express';

// Validation middleware for booking requests
export const validateBookingRequest = (req: Request, res: Response, next: NextFunction) => {
  const { sessionId, description, date } = req.body;

  // Validate and coerce sessionId (handle string numbers)
  const sessionIdNum = Number(sessionId);
  if (!Number.isInteger(sessionIdNum) || sessionIdNum <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Valid session ID is required'
    });
  }
  req.body.sessionId = sessionIdNum;

  // Validate description (REQUIRED for frontend compatibility)
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Description is required'
    });
  }

  // Validate date (optional but if provided, must be strict YYYY-MM-DD format)
  if (date && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    return res.status(400).json({
      success: false,
      message: 'Date must be in YYYY-MM-DD format'
    });
  }

  // Trim description
  req.body.description = description.trim();

  next();
};

// Validation middleware for profile updates
export const validateProfileUpdate = (req: Request, res: Response, next: NextFunction) => {
  const { name, phone, department } = req.body;

  // Validate name (required)
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({
      success: false,
      message: 'Name must be at least 2 characters long'
    });
  }

  // Validate phone (optional but if provided, must be valid format)
  if (phone && (typeof phone !== 'string' || !/^[\d\s\-\+\(\)]+$/.test(phone))) {
    return res.status(400).json({
      success: false,
      message: 'Phone number must contain only digits, spaces, and common phone symbols'
    });
  }

  // Validate department (optional but if provided, must be string)
  if (department && (typeof department !== 'string' || department.trim().length === 0)) {
    return res.status(400).json({
      success: false,
      message: 'Department must be a non-empty string'
    });
  }

  // Trim string fields
  req.body.name = name.trim();
  if (phone) req.body.phone = phone.trim();
  if (department) req.body.department = department.trim();

  next();
};

// Validation middleware for cancellation requests
export const validateCancellationRequest = (req: Request, res: Response, next: NextFunction) => {
  const { sessionId } = req.body;

  // Validate and coerce sessionId (handle string numbers)
  const sessionIdNum = Number(sessionId);
  if (!Number.isInteger(sessionIdNum) || sessionIdNum <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Valid session ID is required'
    });
  }
  req.body.sessionId = sessionIdNum;

  next();
};

// Validation middleware for date queries
export const validateDateQuery = (req: Request, res: Response, next: NextFunction) => {
  const { date } = req.query;

  // Enforce strict YYYY-MM-DD format
  if (date && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    return res.status(400).json({
      success: false,
      message: 'Date must be in YYYY-MM-DD format'
    });
  }

  next();
};
