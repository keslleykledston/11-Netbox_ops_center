import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Server, GitBranch, Users, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

const Dashboard = () => {
  const [activeDevices, setActiveDevices] = useState<number>(0);
  const [discoveredPeers, setDiscoveredPeers] = useState<number>(0);
  const [tenants, setTenants] = useState<number>(0);

  useEffect(() => {
    let isMounted = true;
    api.getStatsOverview()
      .then((res: any) => {
        if (!isMounted) return;
        setActiveDevices(Number(res?.activeDevices || 0));
        setDiscoveredPeers(Number(res?.discoveredPeers || 0));
        setTenants(Number(res?.tenants || 0));
      })
      .catch(() => {
        // silencioso: mantém zeros caso erro/401
      });
    return () => { isMounted = false; };
  }, []);

  const stats = [
    {
      title: "Dispositivos Ativos",
      value: String(activeDevices),
      icon: Server,
      description: "Total de dispositivos com status Ativo",
      trend: "success",
    },
    {
      title: "Peers Descobertos",
      value: String(discoveredPeers),
      icon: GitBranch,
      description: "Total de peers BGP registrados",
      trend: "success",
    },
    {
      title: "Tenantes Registrados",
      value: String(tenants),
      icon: Users,
      description: "Quantidade de tenantes no banco",
      trend: "warning",
    },
    {
      title: "Alertas",
      value: "—",
      icon: AlertCircle,
      description: "Em breve",
      trend: "destructive",
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Visão geral da infraestrutura de rede
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.title}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {stat.title}
                  </CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stat.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Dispositivos Recentes</CardTitle>
              <CardDescription>
                Últimos dispositivos adicionados ao sistema
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 rounded-lg bg-secondary/50"
                  >
                    <div className="flex items-center gap-3">
                      <Server className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium text-sm">Borda-SP-0{i}</p>
                        <p className="text-xs text-muted-foreground">
                          192.168.1.{i}
                        </p>
                      </div>
                    </div>
                    <span className="px-2 py-1 text-xs rounded-full bg-success/20 text-success-foreground">
                      Online
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Atividade Recente</CardTitle>
              <CardDescription>
                Eventos e mudanças na rede
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { type: "success", text: "BGP peer estabelecido com AS64512" },
                  { type: "warning", text: "Interface GigabitEthernet0/1 DOWN" },
                  { type: "success", text: "Configuração atualizada em Borda-RJ-01" },
                ].map((event, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50"
                  >
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full mt-2",
                        event.type === "success" ? "bg-success" : "bg-warning"
                      )}
                    />
                    <div className="flex-1">
                      <p className="text-sm">{event.text}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Há {i + 1} minuto{i > 0 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

const cn = (...classes: string[]) => classes.filter(Boolean).join(" ");

export default Dashboard;
