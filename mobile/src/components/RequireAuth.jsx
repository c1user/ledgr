import { Navigate, useLocation } from "react-router-dom";
import useAuthStore from "../store/authStore.js";
import Splash from "./Splash.jsx";

/**
 * Gates the authenticated shell on authStore.status.
 *   booting          → splash
 *   authed           → children (stale/offline sessions included)
 *   update-required  → /update-required
 *   expired          → /login?expired=1
 *   anon             → /login
 */
export default function RequireAuth({ children }) {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === "booting") return <Splash />;
  if (status === "authed") return children;
  if (status === "update-required") {
    return <Navigate to="/update-required" replace />;
  }
  const search = status === "expired" ? "?expired=1" : "";
  return <Navigate to={`/login${search}`} replace state={{ from: location }} />;
}
