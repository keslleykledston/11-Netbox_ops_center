import React, { useEffect, useState } from "react";
import type { Device } from "@/lib/utils";
import { useDevices } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device: Device | null;
};

export default function EditDeviceDialog({ open, onOpenChange, device }: Props) {
  const { updateDevice } = useDevices();
  const { toast } = useToast();

  const [form, setForm] = useState({
    name: "",
    hostname: "",
    ipAddress: "",
    manufacturer: "",
    model: "",
    deviceType: "router" as Device["deviceType"],
    status: "inactive" as Device["status"],
    credentials: {
      username: "",
      password: "",
    },
    snmpVersion: "v2c" as Device["snmpVersion"],
    snmpCommunity: "",
    snmpPort: 161,
    tenantId: "",
  });

  useEffect(() => {
    if (device) {
      setForm({
        name: device.name || "",
        hostname: device.hostname || "",
        ipAddress: device.ipAddress || "",
        manufacturer: device.manufacturer || "",
        model: device.model || "",
        deviceType: device.deviceType || "router",
        status: device.status || "inactive",
        credentials: {
          username: "",
          password: "",
        },
        snmpVersion: device.snmpVersion || "v2c",
        snmpCommunity: device.snmpCommunity || "",
        snmpPort: device.snmpPort || 161,
        tenantId: device.tenantId || "",
      });
      // Carrega credenciais atuais (mascara)
      api.getDeviceCredentials(device.id).then((c: any) => {
        setForm(prev => ({ ...prev, credentials: { username: c?.username || "", password: c?.hasPassword ? "********" : "" } }));
      }).catch(() => {});
    }
  }, [device]);

  if (!open) return null;

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === "username" || name === "password") {
      setForm((prev) => ({ ...prev, credentials: { ...prev.credentials, [name]: value } }));
    } else if (name === "snmpPort") {
      setForm((prev) => ({ ...prev, snmpPort: Number(value) }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!device) return;

    const patch: Partial<Device> = {
      name: form.name,
      hostname: form.hostname,
      ipAddress: form.ipAddress,
      manufacturer: form.manufacturer,
      model: form.model,
      deviceType: form.deviceType,
      status: form.status,
      snmpVersion: form.snmpVersion,
      snmpCommunity: form.snmpCommunity,
      snmpPort: form.snmpPort,
      tenantId: form.tenantId,
    };

    try {
      const ok = updateDevice(device.id, patch);
      if (ok) {
        // Atualiza credenciais separadamente se alteradas
        try {
          const payload: any = {};
          if (form.credentials.username !== undefined) payload.username = form.credentials.username;
          if (form.credentials.password && form.credentials.password !== '********') payload.password = form.credentials.password;
          if (Object.keys(payload).length > 0) {
            await api.updateDeviceCredentials(device.id, payload);
          }
        } catch {}
        toast({ title: "Dispositivo atualizado", description: "Alterações salvas com sucesso!" });
        onOpenChange(false);
      } else {
        toast({ title: "Erro ao atualizar", description: "Dispositivo não encontrado.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro ao atualizar", description: "Não foi possível salvar as alterações.", variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-zinc-900 text-white rounded-lg shadow-xl w-full max-w-2xl">
        <div className="px-6 py-4 border-b border-zinc-700">
          <h2 className="text-lg font-semibold">Editar Dispositivo</h2>
        </div>
        <form onSubmit={onSubmit} className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-sm">Nome</span>
              <input name="name" value={form.name} onChange={onChange} className="border rounded px-3 py-2 bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">Hostname</span>
              <input name="hostname" value={form.hostname} onChange={onChange} className="border rounded px-3 py-2 bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">IP Address</span>
              <input name="ipAddress" value={form.ipAddress} onChange={onChange} className="border rounded px-3 py-2 bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">Fabricante</span>
              <input name="manufacturer" value={form.manufacturer} onChange={onChange} className="border rounded px-3 py-2 bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">Modelo</span>
              <input name="model" value={form.model} onChange={onChange} className="border rounded px-3 py-2 bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">Tipo</span>
              <select name="deviceType" value={form.deviceType} onChange={onChange} className="border rounded px-3 py-2 bg-zinc-800 text-white border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500">
                <option value="router">Roteador</option>
                <option value="switch">Switch</option>
                <option value="firewall">Firewall</option>
                <option value="server">Servidor</option>
                <option value="other">Outro</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">Status</span>
              <select name="status" value={form.status} onChange={onChange} className="border rounded px-3 py-2 bg-zinc-800 text-white border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500">
                <option value="active">Ativo</option>
                <option value="maintenance">Manutenção</option>
                <option value="inactive">Inativo</option>
              </select>
            </label>
          </div>

          <div className="mt-2">
            <h3 className="text-sm font-medium">Credenciais SSH</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
              <label className="flex flex-col gap-1">
                <span className="text-sm">Usuário</span>
                <input name="username" value={form.credentials.username} onChange={onChange} className="border rounded px-3 py-2 bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm">Senha</span>
                <input type="password" name="password" value={form.credentials.password} onChange={onChange} className="border rounded px-3 py-2 bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500" />
                <button type="button" className="text-xs text-blue-400 mt-1 w-max" onClick={async () => {
                  if (!device) return;
                  if (form.credentials.password === '********') {
                    try { const c: any = await api.getDeviceCredentials(device.id, true); setForm(prev => ({ ...prev, credentials: { ...prev.credentials, password: c?.password || '' } })); } catch {}
                  } else {
                    setForm(prev => ({ ...prev, credentials: { ...prev.credentials, password: '********' } }));
                  }
                }}>
                  {form.credentials.password === '********' ? 'Exibir' : 'Ocultar'} senha
                </button>
              </label>
            </div>
          </div>

          <div className="mt-2">
            <h3 className="text-sm font-medium">SNMP</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
              <label className="flex flex-col gap-1">
                <span className="text-sm">Versão</span>
                <select name="snmpVersion" value={form.snmpVersion} onChange={onChange} className="border rounded px-3 py-2 bg-zinc-800 text-white border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500">
                  <option value="v1">v1</option>
                  <option value="v2c">v2c</option>
                  <option value="v3">v3</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm">Community</span>
                <input name="snmpCommunity" value={form.snmpCommunity} onChange={onChange} className="border rounded px-3 py-2 bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm">Porta</span>
                <input type="number" name="snmpPort" value={form.snmpPort} onChange={onChange} className="border rounded px-3 py-2 bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500" />
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-zinc-700 mt-4">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 rounded border border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-700"
            >
              Cancelar
            </button>
            <button type="submit" className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
