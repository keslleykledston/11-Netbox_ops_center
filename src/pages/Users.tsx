import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type UserRow = { id: number; email: string; username?: string; role: string; isActive: boolean; tenantId?: number | null; mustResetPassword?: boolean };

const Users = () => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [form, setForm] = useState({ email: "", username: "", password: "", role: "user", isActive: true, tenantId: "" });
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const [u, t] = await Promise.all([api.adminListUsers(), api.listTenants()]);
      setUsers(u as any);
      setTenants(t as any);
    } catch {
      setUsers([]);
    }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.email || !form.password) { alert("email e senha obrigatórios"); return; }
    setLoading(true);
    try {
      await api.adminCreateUser({ email: form.email, username: form.username || undefined, password: form.password, role: form.role, isActive: form.isActive, tenantId: form.tenantId ? Number(form.tenantId) : undefined });
      setForm({ email: "", username: "", password: "", role: "user", isActive: true, tenantId: "" });
      await load();
    } catch (e: any) { alert(String(e?.message || e)); } finally { setLoading(false); }
  };

  const toggleActive = async (u: UserRow) => {
    try { await api.adminUpdateUser(u.id, { isActive: !u.isActive }); await load(); } catch (e: any) { alert(String(e?.message || e)); }
  };

  const changeRole = async (u: UserRow, role: string) => { try { await api.adminUpdateUser(u.id, { role }); await load(); } catch (e: any) { alert(String(e?.message || e)); } };
  const resetPass = async (u: UserRow) => { const p = prompt(`Nova senha para ${u.email}:`); if (!p) return; try { await api.adminUpdateUser(u.id, { password: p }); alert("Senha atualizada"); } catch (e: any) { alert(String(e?.message || e)); } };
  const forceReset = async (u: UserRow) => { try { await api.adminUpdateUser(u.id, { mustResetPassword: true }); await load(); } catch (e: any) { alert(String(e?.message || e)); } };
  const updateTenant = async (u: UserRow, tenantId: string) => { try { await api.adminUpdateUser(u.id, { tenantId: tenantId ? Number(tenantId) : undefined }); await load(); } catch (e: any) { alert(String(e?.message || e)); } };
  const removeUser = async (u: UserRow) => { if (!confirm(`Remover ${u.email}?`)) return; try { await api.adminDeleteUser(u.id); await load(); } catch (e: any) { alert(String(e?.message || e)); } };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Usuários</h1>
          <p className="text-muted-foreground mt-2">Gerencie contas, papéis e escopo de tenant (admin).</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Novo Usuário</CardTitle>
            <CardDescription>Criar um novo usuário</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <Input placeholder="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400" />
            <Input placeholder="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400" />
            <Input type="password" placeholder="senha" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400" />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="border rounded px-3 py-2 bg-zinc-800 text-white border-zinc-700">
              <option value="user">user</option>
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
            <select value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} className="border rounded px-3 py-2 bg-zinc-800 text-white border-zinc-700">
              <option value="">(sem tenant / global)</option>
              {tenants.map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <Button onClick={create} disabled={loading}>Criar</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lista de Usuários</CardTitle>
            <CardDescription>Alterar papéis, ativação, senha e tenant.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto border rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">ID</th>
                    <th className="text-left px-3 py-2">Email</th>
                    <th className="text-left px-3 py-2">Username</th>
                    <th className="text-left px-3 py-2">Role</th>
                    <th className="text-left px-3 py-2">Ativo</th>
                    <th className="text-left px-3 py-2">Tenant</th>
                    <th className="text-left px-3 py-2">Reset Obrigatório</th>
                    <th className="text-left px-3 py-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-border/40">
                      <td className="px-3 py-1.5">{u.id}</td>
                      <td className="px-3 py-1.5">{u.email}</td>
                      <td className="px-3 py-1.5">{u.username}</td>
                      <td className="px-3 py-1.5">
                        <select value={u.role} onChange={(e) => changeRole(u, e.target.value)} className="border rounded px-2 py-1 bg-zinc-800 text-white border-zinc-700">
                          <option value="user">user</option>
                          <option value="viewer">viewer</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        <Button variant="outline" size="sm" onClick={() => toggleActive(u)}>{u.isActive ? 'Desativar' : 'Ativar'}</Button>
                      </td>
                      <td className="px-3 py-1.5">
                        <select value={u.tenantId || ''} onChange={(e) => updateTenant(u, e.target.value)} className="border rounded px-2 py-1 bg-zinc-800 text-white border-zinc-700">
                          <option value="">(sem)</option>
                          {tenants.map((t: any) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        {u.mustResetPassword ? <span className="text-xs px-2 py-1 rounded bg-warning/20 text-warning">Sim</span> : <span className="text-xs text-muted-foreground">Não</span>}
                      </td>
                      <td className="px-3 py-1.5 flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => resetPass(u)}>Reset Senha</Button>
                        <Button variant="outline" size="sm" onClick={() => forceReset(u)}>Forçar reset no próximo login</Button>
                        <Button variant="destructive" size="sm" onClick={() => removeUser(u)}>Remover</Button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td className="px-3 py-3 text-muted-foreground" colSpan={7}>Nenhum usuário</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default Users;
