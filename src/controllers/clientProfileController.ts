import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest, requireClient } from '../middleware/authMiddleware';

// Get client Profile (for client profile page)
export const getclientProfile = async (req: AuthRequest, res: Response) => {
  try {
    const client = req.client; // Pre-populated by middleware

    if (!client) {
      return res.status(401).json({ 
        success: false,
        message: 'client not authenticated' 
      });
    }

    const user = await prisma.user.findUnique({
      where: { userId: req.user!.userId },
      include: {
        clientProfile: true
      }
    });

    if (!user || !user.clientProfile) {
      return res.status(404).json({ 
        success: false,
        message: 'client profile not found' 
      });
    }

    // Format for frontend clientProfileProps
    const profile = {
      name: `${user.firstName} ${user.lastName}`,
      email: user.cmuAccount,
      phone: user.phoneNum || '',
      clientId: user.clientProfile.clientId,
      department: user.clientProfile.department || '',
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
    console.error('Error getting client profile:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to retrieve client profile' 
    });
  }
};

// Update client Profile
export const updateclientProfile = async (req: AuthRequest, res: Response) => {
  try {
    const client = req.client; // Pre-populated by middleware
    const { name, phone, department } = req.body;

    if (!client) {
      return res.status(401).json({ 
        success: false,
        message: 'client not authenticated' 
      });
    }

    // Split name into first and last name
    const nameParts = name.trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Update user information
    const updatedUser = await prisma.user.update({
      where: { userId: req.user!.userId },
      data: {
        firstName,
        lastName,
        phoneNum: phone
      },
      include: {
        clientProfile: true
      }
    });

    // Update client profile
    const updatedclient = await prisma.client.update({
      where: { clientId: client.clientId },
      data: {
        department
      }
    });

    // Format response for frontend
    const profile = {
      name: `${updatedUser.firstName} ${updatedUser.lastName}`,
      email: updatedUser.cmuAccount,
      phone: updatedUser.phoneNum || '',
      clientId: updatedclient.clientId,
      department: updatedclient.department || '',
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
    console.error('Error updating client profile:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to update client profile' 
    });
  }
};
