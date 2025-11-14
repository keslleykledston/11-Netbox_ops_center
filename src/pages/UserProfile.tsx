import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const UserProfile = () => {
  const [me, setMe] = useState<any>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    api.getMe().then(setMe).catch(() => setMe(null));
  }, []);

  const doChangePassword = async () => {
    if (!me) return;
    if (!newPassword || newPassword !== confirmPassword) {
      toast({ title: 'Senhas não conferem', description: 'Verifique os campos.', variant: 'destructive' });
      return;
    }
    try {
      await api.changePassword(me.email || me.username, currentPassword, newPassword);
      toast({ title: 'Senha alterada', description: 'Use a nova senha no próximo login.' });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (e: any) {
      toast({ title: 'Falha ao alterar', description: String(e?.message || e), variant: 'destructive' });
    }
  };

  const doSaveProfile = async () => {
    if (!me) return;
    try {
      await api.updateMe({ username: me.username });
      toast({ title: 'Perfil atualizado', description: 'Seu username foi alterado.' });
    } catch (e: any) {
      toast({ title: 'Falha ao salvar perfil', description: String(e?.message || e), variant: 'destructive' });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Usuário</h1>
          <p className="text-muted-foreground mt-2">Dados da sua conta e troca de senha</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Meu Perfil</CardTitle>
            <CardDescription>Informações básicas</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input readOnly value={me?.email || ''} placeholder="Email" className="bg-muted/40" />
            <Input value={me?.username || ''} placeholder="Username" onChange={(e) => setMe((prev: any) => ({ ...prev, username: e.target.value }))} />
            <Input readOnly value={me?.role || ''} placeholder="Papel" className="bg-muted/40" />
            <Input readOnly value={me?.tenantId ?? ''} placeholder="Tenant" className="bg-muted/40" />
            <div className="md:col-span-2">
              <Button onClick={doSaveProfile}>Salvar Perfil</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alterar Senha</CardTitle>
            <CardDescription>Informe a senha atual e a nova senha</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input type="password" placeholder="Senha atual" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            <Input type="password" placeholder="Nova senha" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <Input type="password" placeholder="Confirmar nova senha" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            <div className="md:col-span-3">
              <Button onClick={doChangePassword}>Salvar nova senha</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default UserProfile;
