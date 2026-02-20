import { Request, Response, NextFunction } from 'express';

// Validation middleware for booking requests
export const validateBookingRequest = (req: Request, res: Response, next: NextFunction) => {
  const { sessionId, date, time, description, counselorId, counselorName, studentId, faculty, phone } = req.body;

  const normalizedSessionId = sessionId !== undefined && sessionId !== null ? Number(sessionId) : null;
  const hasSessionId = normalizedSessionId !== null && Number.isInteger(normalizedSessionId) && normalizedSessionId > 0;
  const hasDateTime = typeof date === 'string' && date.trim().length > 0 && typeof time === 'string' && /^(\d{1,2}:\d{2})(:\d{2})?$/.test(time.trim());

  if (!hasSessionId && !hasDateTime) {
    return res.status(400).json({
      success: false,
      message: 'Provide either a valid sessionId or both date and time'
    });
  }

  if (hasSessionId) {
    req.body.sessionId = normalizedSessionId;
  }

  if (typeof date === 'string') {
    req.body.date = date.trim();
  }

  if (typeof time === 'string') {
    req.body.time = time.trim();
  }

  if (description !== undefined) {
    if (typeof description !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Description must be a string'
      });
    }
    req.body.description = description.trim();
  }

  if (counselorId !== undefined && counselorId !== null) {
    const counselorIdNum = Number(counselorId);
    if (!Number.isInteger(counselorIdNum) || counselorIdNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid counselorId'
      });
    }
    req.body.counselorId = counselorIdNum;
  }

  if (counselorName !== undefined && typeof counselorName !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'counselorName must be a string'
    });
  }

  if (typeof counselorName === 'string') {
    req.body.counselorName = counselorName.trim();
  }

  if (studentId !== undefined) {
    if (typeof studentId !== 'string' || !/^\d{9}$/.test(studentId.trim())) {
      return res.status(400).json({
        success: false,
        message: 'studentId must be exactly 9 digits'
      });
    }
    req.body.studentId = studentId.trim();
  }

  if (faculty !== undefined && typeof faculty !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'faculty must be a string'
    });
  }

  if (faculty !== undefined && typeof faculty === 'string') {
    req.body.faculty = faculty.trim();
  }

  if (phone !== undefined) {
    if (typeof phone !== 'string' || !/^\d{10}$/.test(phone.trim())) {
      return res.status(400).json({
        success: false,
        message: 'phone must be exactly 10 digits'
      });
    }
    req.body.phone = phone.trim();
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

  // Accept both ISO and localized date strings (Thai calendar format from frontend)
  if (date && (typeof date !== 'string' || date.trim().length === 0)) {
    return res.status(400).json({
      success: false,
      message: 'date must be a non-empty string'
    });
  }

  next();
};
