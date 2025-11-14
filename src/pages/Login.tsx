import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Network } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const useBackend = import.meta.env.VITE_USE_BACKEND === "true";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!useBackend) {
      navigate("/dashboard");
      return;
    }
    try {
      await api.login(identifier, password);
      navigate("/dashboard");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao autenticar";
      if (/Password reset required/i.test(msg)) {
        setShowReset(true);
        toast({ title: "Senha precisa ser redefinida", description: "Informe a nova senha e confirme.", variant: "destructive" });
      } else {
        toast({ title: "Falha no login", description: msg, variant: "destructive" });
      }
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.changePassword(identifier, password, newPassword);
      toast({ title: "Senha alterada", description: "Entre novamente." });
      setShowReset(false);
      setPassword("");
      setNewPassword("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao alterar senha";
      toast({ title: "Falha", description: msg, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4 text-center">
          <div className="flex justify-center">
            <div className="p-3 bg-primary/10 rounded-full">
              <Network className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Network Management</CardTitle>
          <CardDescription>
            Entre com suas credenciais para acessar o sistema
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">Usuário ou Email</Label>
              <Input
                id="identifier"
                type="text"
                placeholder="usuario ou email"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full">
              Entrar
            </Button>
            <div className="text-center text-sm text-muted-foreground mt-2">
              Não tem conta? <Link to="/register" className="text-primary underline">Cadastre-se</Link>
            </div>
          </form>
          {showReset && (
            <form onSubmit={handleChangePassword} className="space-y-3 mt-6">
              <div className="space-y-2">
                <Label htmlFor="new-password">Nova Senha</Label>
                <Input id="new-password" type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full" variant="outline">Redefinir senha e continuar</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
