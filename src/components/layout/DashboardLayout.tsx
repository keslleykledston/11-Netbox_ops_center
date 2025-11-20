import { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Network, LayoutDashboard, Server, Settings, GitBranch, FileJson, LogOut, Wrench, Users as UsersIcon, HardDrive, Terminal } from "lucide-react";
import { getToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import IdleSessionManager from "@/components/session/IdleSessionManager";

interface DashboardLayoutProps { children: ReactNode; }

const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const token = typeof window !== 'undefined' ? getToken() : "";
  let isAdmin = false;
  try {
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1] || ''));
      isAdmin = String(payload?.role || '').toLowerCase() === 'admin';
    }
  } catch {}

  const navigation = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Dispositivos", href: "/devices", icon: Server },
    { name: "Acesso Remoto", href: "/access/terminal", icon: Terminal },
    { name: "Peers BGP", href: "/bgp-peers", icon: GitBranch },
    { name: "Backup", href: "/backup", icon: HardDrive },
    { name: "Configurações", href: "/configurations", icon: FileJson },
    { name: "Aplicações", href: "/applications", icon: Settings },
    { name: "Manutenção", href: "/maintenance", icon: Wrench },
    ...(isAdmin ? [{ name: "Usuários", href: "/users", icon: UsersIcon }] : [{ name: "Usuário", href: "/me", icon: UsersIcon }]),
  ];

  const handleLogout = () => {
    try {
      localStorage.removeItem("auth_token");
    } catch {}
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
