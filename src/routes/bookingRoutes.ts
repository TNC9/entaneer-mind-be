import { Router } from 'express';
import { searchSlots, bookSlot, getStudentBookings, cancelBooking } from '../controllers/bookingController';
import { authenticateToken, requireStudent } from '../middleware/authMiddleware';
import { validateBookingRequest, validateCancellationRequest, validateDateQuery } from '../middleware/validationMiddleware';

const router = Router();

// Public routes (no authentication required)
router.get('/slots', validateDateQuery, searchSlots);

// Student-only routes
router.post('/bookings', authenticateToken, requireStudent, validateBookingRequest, bookSlot);
router.get('/student/bookings', authenticateToken, requireStudent, getStudentBookings);
router.post('/bookings/cancel', authenticateToken, requireStudent, validateCancellationRequest, cancelBooking);

export default router;
