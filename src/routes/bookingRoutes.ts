import { Router } from 'express';
import {
  searchSlots,
  bookSlot,
  getClientBookings,
  cancelBooking,
  getCounselorTodayAppointments
} from '../controllers/bookingController';
import { authenticateToken, requireClient } from '../middleware/authMiddleware';
import { validateBookingRequest, validateCancellationRequest, validateDateQuery } from '../middleware/validationMiddleware';

const router = Router();

// Frontend booking contract routes (/api/appointments/*)
router.get('/counselor/today', validateDateQuery, getCounselorTodayAppointments);
router.post('/book', authenticateToken, requireClient, validateBookingRequest, bookSlot);
router.get('/my', authenticateToken, requireClient, getClientBookings);

// Optional helpers/legacy aliases
router.get('/slots', validateDateQuery, searchSlots);
router.post('/cancel', authenticateToken, requireClient, validateCancellationRequest, cancelBooking);
router.post('/bookings', authenticateToken, requireClient, validateBookingRequest, bookSlot);
router.get('/client/bookings', authenticateToken, requireClient, getClientBookings);
router.post('/bookings/cancel', authenticateToken, requireClient, validateCancellationRequest, cancelBooking);

export default router;
