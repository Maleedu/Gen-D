import { createContext } from 'react';

export type AuthContextValue = {
  status: 'loading' | 'signed-out' | 'authorized';
  email: string | null;
  notAuthorizedMessage: string | null;
  clearNotAuthorizedMessage: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
