import { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Network, LayoutDashboard, Server, Settings, GitBranch, LogOut, Wrench, Users as UsersIcon, HardDrive, Terminal, Layers, Globe, Database } from "lucide-react";
import { getToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import IdleSessionManager from "@/components/session/IdleSessionManager";
import { useTenantContext } from "@/contexts/TenantContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DashboardLayoutProps { children: ReactNode; }

const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { tenants, selectedTenantId, setSelectedTenantId, isAdmin, loading } = useTenantContext();
  const token = typeof window !== 'undefined' ? getToken() : "";
  let isAdminFromToken = false;
  try {
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1] || ''));
      isAdminFromToken = String(payload?.role || '').toLowerCase() === 'admin';
    }
  } catch { }

  const resolvedIsAdmin = isAdmin || isAdminFromToken;

  const navigation = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Dispositivos", href: "/devices", icon: Server },
    { name: "Acesso Remoto", href: "/access/terminal", icon: Terminal },
    { name: "Peers BGP", href: "/bgp-peers", icon: GitBranch },
    { name: "Looking Glass", href: "/looking-glass", icon: Globe },
    { name: "Gerenciador IRR", href: "/irr-manager", icon: Database },
    { name: "Backup", href: "/backup", icon: HardDrive },
    { name: "Oxidized Proxies", href: "/oxidized-proxies", icon: Layers },
    { name: "Aplicações", href: "/applications", icon: Settings },
    { name: "Manutenção", href: "/maintenance", icon: Wrench },
    ...(resolvedIsAdmin ? [{ name: "Usuários", href: "/users", icon: UsersIcon }] : [{ name: "Usuário", href: "/me", icon: UsersIcon }]),
  ];

  const handleLogout = () => {
    try {
      localStorage.removeItem("auth_token");
    } catch { }
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      <IdleSessionManager />
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
          <Network className="h-6 w-6 text-sidebar-primary" />
          <span className="text-lg font-semibold text-sidebar-foreground">
            NetManager
          </span>
        </div>
        <div className="border-b border-sidebar-border px-4 py-3">
          <p className="text-xs text-muted-foreground mb-1">Tenant ativo</p>
          {resolvedIsAdmin ? (
            <Select
              value={selectedTenantId ? String(selectedTenantId) : undefined}
              onValueChange={(v) => setSelectedTenantId(v ? v : null)}
              disabled={loading || tenants.length === 0}
            >
              <SelectTrigger className="h-9 bg-sidebar-accent/30 border-sidebar-border text-sidebar-foreground">
                <SelectValue placeholder="Selecione o tenant" />
              </SelectTrigger>
              <SelectContent>
                {tenants.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">Nenhum tenant disponível</div>
                ) : (
                  tenants.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          ) : (
            <div className="rounded-md bg-sidebar-accent/30 px-2 py-1 text-sm text-sidebar-foreground">
              {tenants.find((t) => String(t.id) === (selectedTenantId || ""))?.name || "Tenant atribuído"}
            </div>
          )}
        </div>
        <nav className="flex flex-col gap-1 p-4">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-4 left-4 right-4">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent/50"
            onClick={handleLogout}
          >
            <LogOut className="h-5 w-5" />
            Sair
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="pl-64">
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
};

export default DashboardLayout;
