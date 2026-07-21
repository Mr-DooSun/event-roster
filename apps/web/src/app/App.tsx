import { AuthProvider } from "../features/auth/AuthProvider";
import { AuthBoundary } from "./router";

export function App() {
  return (
    <AuthProvider>
      <AuthBoundary />
    </AuthProvider>
  );
}
