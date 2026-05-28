import { useQuery, useQueryClient } from 'react-query';

// contexts
import { useAuth } from 'contexts/AuthContext';

import type { QueryObserverOptions } from 'react-query';
import type { User, UserData, UserWithToken } from 'types/user';

// Hook to get current user - now uses Firebase AuthContext
export const useMe = (queryConfig?: QueryObserverOptions<User, Error, UserWithToken>) => {
  const { userProfile, currentUser, loading } = useAuth();

  // Convert Firestore user profile to User type for compatibility
  const user: UserWithToken | null = userProfile && currentUser ? {
    _id: userProfile.uid || userProfile.id,
    id: userProfile.uid || userProfile.id,
    email: userProfile.email,
    name: userProfile.name || userProfile.displayName || userProfile.email,
    photo: userProfile.photo || null,
    provider: userProfile.provider || 'email',
    role: userProfile.role || 'USER',
    createdAt: userProfile.createdAt?.toDate?.() || new Date(),
    updatedAt: userProfile.updatedAt?.toDate?.() || new Date(),
    extraUserData: {
      apps: userProfile.apps || [],
    },
    token: currentUser ? `Bearer ${currentUser.uid}` : '',
  } : null;

  return {
    data: user,
    isLoading: loading,
    error: null,
    ...queryConfig,
  };
};

// Hook to fetch user data - now uses Firebase AuthContext
export const useFetchUserData = (queryConfig?: QueryObserverOptions<UserData, Error>) => {
  const queryClient = useQueryClient();
  const { userProfile, loading } = useAuth();

  // Convert Firestore user profile to UserData type for compatibility
  const userData: UserData | null = userProfile ? {
    createdAt: userProfile.createdAt?.toDate?.() || new Date(),
    applicationData: {
      rw: userProfile.applicationData?.rw || {},
    },
  } : null;

  return {
    data: userData,
    isLoading: loading,
    error: null,
    refetchOnWindowFocus: false,
    placeholderData: queryClient.getQueryData('user-data') || userData,
    ...queryConfig,
  };
};
