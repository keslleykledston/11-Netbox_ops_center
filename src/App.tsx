import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Devices from "./pages/Devices";
import BgpPeers from "./pages/BgpPeers";
import Applications from "./pages/Applications";
import Backup from "./pages/Backup";
import Maintenance from "./pages/Maintenance";
import Users from "./pages/Users";
import UserProfile from "./pages/UserProfile";
import NotFound from "./pages/NotFound";
import OperationalHub from "./pages/OperationalHub";
import OxidizedProxy from "./pages/OxidizedProxy";
import { getToken } from "@/lib/api";
import RemoteAccess from "./modules/access/RemoteAccess";
import LookingGlassPage from "./pages/LookingGlassPage";
import IRRPage from "./pages/IRRPage";
import { TenantProvider } from "@/contexts/TenantContext";

const queryClient = new QueryClient();

const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  return children;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <TenantProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="/hub" element={<RequireAuth><OperationalHub /></RequireAuth>} />
            <Route path="/devices" element={<RequireAuth><Devices /></RequireAuth>} />
            <Route path="/bgp-peers" element={<RequireAuth><BgpPeers /></RequireAuth>} />
            <Route path="/applications" element={<RequireAuth><Applications /></RequireAuth>} />
            <Route path="/backup" element={<RequireAuth><Backup /></RequireAuth>} />
            <Route path="/maintenance" element={<RequireAuth><Maintenance /></RequireAuth>} />
            <Route path="/access/terminal" element={<RequireAuth><RemoteAccess /></RequireAuth>} />
            <Route path="/looking-glass" element={<RequireAuth><LookingGlassPage /></RequireAuth>} />
            <Route path="/irr-manager" element={<RequireAuth><IRRPage /></RequireAuth>} />
            <Route path="/oxidized-proxies" element={<RequireAuth><OxidizedProxy /></RequireAuth>} />
            <Route path="/users" element={<RequireAuth><Users /></RequireAuth>} />
            <Route path="/me" element={<RequireAuth><UserProfile /></RequireAuth>} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TenantProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
