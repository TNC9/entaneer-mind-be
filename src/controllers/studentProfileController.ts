import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/authMiddleware';

// Get Student Profile (for student profile page)
export const getStudentProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ 
        success: false,
        message: 'User not authenticated' 
      });
    }

    // Get student from userId
    const student = await prisma.student.findUnique({
      where: { userId }
    });

    if (!student) {
      return res.status(404).json({ 
        success: false,
        message: 'Student not found' 
      });
    }

    const user = await prisma.user.findUnique({
      where: { userId },
      include: {
        studentProfile: true
      }
    });

    if (!user || !user.studentProfile) {
      return res.status(404).json({ 
        success: false,
        message: 'Student profile not found' 
      });
    }

    // Format for frontend StudentProfileProps
    const profile = {
      name: `${user.firstName} ${user.lastName}`,
      email: user.cmuAccount,
      phone: user.phoneNum || '',
      studentId: user.studentProfile.studentId,
      department: user.studentProfile.department || '',
      enrollmentDate: user.createdAt.toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'long', 
        year: 'numeric'
      })
    };

    res.status(200).json({
      success: true,
      data: profile
    });

  } catch (error) {
    console.error('Error getting student profile:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to retrieve student profile' 
    });
  }
};

// Update Student Profile
export const updateStudentProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { name, phone, department } = req.body;

    if (!userId) {
      return res.status(401).json({ 
        success: false,
        message: 'User not authenticated' 
      });
    }

    // Get student from userId
    const student = await prisma.student.findUnique({
      where: { userId }
    });

    if (!student) {
      return res.status(404).json({ 
        success: false,
        message: 'Student not found' 
      });
    }

    // Split name into first and last name
    const nameParts = name.trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Update user information
    const updatedUser = await prisma.user.update({
      where: { userId },
      data: {
        firstName,
        lastName,
        phoneNum: phone
      },
      include: {
        studentProfile: true
      }
    });

    // Update student profile
    const updatedStudent = await prisma.student.update({
      where: { studentId: student.studentId },
      data: {
        department
      }
    });

    // Format response for frontend
    const profile = {
      name: `${updatedUser.firstName} ${updatedUser.lastName}`,
      email: updatedUser.cmuAccount,
      phone: updatedUser.phoneNum || '',
      studentId: updatedStudent.studentId,
      department: updatedStudent.department || '',
      enrollmentDate: updatedUser.createdAt.toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'long', 
        year: 'numeric'
      })
    };

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: profile
    });

  } catch (error) {
    console.error('Error updating student profile:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to update student profile' 
    });
  }
};
