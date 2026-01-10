import { Request, Response, NextFunction } from 'express';

// Validation middleware for booking requests
export const validateBookingRequest = (req: Request, res: Response, next: NextFunction) => {
  const { sessionId, description, date } = req.body;

  // Validate sessionId
  if (!sessionId || typeof sessionId !== 'number' || sessionId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Valid session ID is required'
    });
  }

  // Validate description (optional but if provided, must be string)
  if (description && (typeof description !== 'string' || description.trim().length === 0)) {
    return res.status(400).json({
      success: false,
      message: 'Description must be a non-empty string'
    });
  }

  // Validate date (optional but if provided, must be valid date string)
  if (date && (typeof date !== 'string' || isNaN(Date.parse(date)))) {
    return res.status(400).json({
      success: false,
      message: 'Date must be a valid date string'
    });
  }

  // Trim description if provided
  if (description) {
    req.body.description = description.trim();
  }

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

  if (!sessionId || typeof sessionId !== 'number' || sessionId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Valid session ID is required'
    });
  }

  next();
};

// Validation middleware for date queries
export const validateDateQuery = (req: Request, res: Response, next: NextFunction) => {
  const { date } = req.query;

  if (date && (typeof date !== 'string' || isNaN(Date.parse(date as string)))) {
    return res.status(400).json({
      success: false,
      message: 'Date must be a valid date string (YYYY-MM-DD format)'
    });
  }

  next();
};
