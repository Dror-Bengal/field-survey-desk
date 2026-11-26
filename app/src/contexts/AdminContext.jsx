import { createContext, useContext } from 'react';

// Lets the admin shell expose live counters + refetch handles (pending
// applicants, pending scope-requests) to deeply-nested admin screens
// without prop-drilling.
export const AdminContext = createContext({
  pendingCount: 0,
  refetchPending: () => {},
  scopeRequestsCount: 0,
  refetchScopeRequests: () => {},
});

export function useAdminContext() {
  return useContext(AdminContext);
}
