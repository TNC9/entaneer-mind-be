import { Router } from 'express';
import { searchSlots, bookSlot, getClientBookings, cancelBooking } from '../controllers/bookingController';
import { authenticateToken, requireClient } from '../middleware/authMiddleware';
import { validateBookingRequest, validateCancellationRequest, validateDateQuery } from '../middleware/validationMiddleware';

const router = Router();

// Public routes (no authentication required)
router.get('/slots', validateDateQuery, searchSlots);

// Client-only routes
router.post('/bookings', authenticateToken, requireClient, validateBookingRequest, bookSlot);
router.get('/client/bookings', authenticateToken, requireClient, getClientBookings);
router.post('/bookings/cancel', authenticateToken, requireClient, validateCancellationRequest, cancelBooking);

export default router;
