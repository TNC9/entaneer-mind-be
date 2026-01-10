import { Router } from 'express';
import { searchSlots, bookSlot, getStudentBookings, cancelBooking } from '../controllers/bookingController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// GET /api/slots - Search available slots
router.get('/slots', searchSlots);

// POST /api/bookings - Book a slot
router.post('/bookings', authenticateToken, bookSlot);

// GET /api/student/bookings - Get student booking history
router.get('/student/bookings', authenticateToken, getStudentBookings);

// POST /api/bookings/cancel - Cancel booking (additional endpoint for cancellation)
router.post('/bookings/cancel', authenticateToken, cancelBooking);

export default router;
