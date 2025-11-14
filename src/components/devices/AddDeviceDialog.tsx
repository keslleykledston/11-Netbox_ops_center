import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useDevices } from "@/hooks/use-mobile";

const deviceFormSchema = z.object({
  name: z.string()
    .min(3, { message: "Nome deve ter pelo menos 3 caracteres" })
    .max(50, { message: "Nome deve ter no máximo 50 caracteres" }),
  ip: z.string()
    .regex(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/, { message: "IP inválido (ex: 192.168.1.1)" }),
  manufacturer: z.string()
    .min(2, { message: "Selecione o fabricante" }),
  model: z.string()
    .min(2, { message: "Modelo deve ter pelo menos 2 caracteres" })
    .max(50, { message: "Modelo deve ter no máximo 50 caracteres" }),
  login: z.string()
    .min(3, { message: "Login deve ter pelo menos 3 caracteres" })
    .max(50, { message: "Login deve ter no máximo 50 caracteres" }),
  password: z.string()
    .min(6, { message: "Senha deve ter pelo menos 6 caracteres" })
    .max(100, { message: "Senha deve ter no máximo 100 caracteres" }),
  snmpCommunity: z.string()
    .min(3, { message: "Community string deve ter pelo menos 3 caracteres" })
    .max(100, { message: "Community string deve ter no máximo 100 caracteres" }),
  snmpVersion: z.enum(["v2c", "v3"], {
    required_error: "Selecione a versão SNMP",
  }),
  snmpPort: z.string()
    .regex(/^[0-9]+$/, { message: "Porta deve ser um número" })
    .refine((val) => {
      const port = parseInt(val);
      return port >= 1 && port <= 65535;
    }, { message: "Porta deve estar entre 1 e 65535" })
    .default("161"),
});

type DeviceFormValues = z.infer<typeof deviceFormSchema>;

interface AddDeviceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const manufacturers = [
  "Huawei",
  "Cisco",
  "Juniper",
  "Nokia",
  "Arista",
  "Extreme Networks",
  "HPE",
  "Dell",
  "Mikrotik",
];

const AddDeviceDialog = ({ open, onOpenChange }: AddDeviceDialogProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { createDevice } = useDevices();

  const form = useForm<DeviceFormValues>({
    resolver: zodResolver(deviceFormSchema),
    defaultValues: {
      name: "",
      ip: "",
      manufacturer: "",
      model: "",
      login: "",
      password: "",
      snmpCommunity: "public",
      snmpVersion: "v2c",
      snmpPort: "161",
    },
  });

  const onSubmit = async (data: DeviceFormValues) => {
    setIsSubmitting(true);
    try {
      const newDevice = {
        tenantId: "default-tenant",
        name: data.name,
        hostname: data.name,
        ipAddress: data.ip,
        deviceType: "router" as const,
        manufacturer: data.manufacturer,
        model: data.model,
        status: "inactive" as const,
        credentials: {
          username: data.login,
          password: data.password,
        },
        snmpVersion: data.snmpVersion,
        snmpCommunity: data.snmpCommunity,
        snmpPort: parseInt(data.snmpPort, 10),
      };

      const success = await createDevice(newDevice);
      
      if (success) {
        toast.success("Dispositivo salvo com sucesso!", {
          description: `${data.name} foi adicionado ao banco de dados.`,
        });
        form.reset();
        onOpenChange(false);
      } else {
        toast.error("Erro ao salvar", {
          description: "Não foi possível salvar o dispositivo.",
        });
      }
    } catch (error) {
      toast.error("Erro ao salvar", {
        description: error instanceof Error ? error.message : "Erro desconhecido ao salvar dispositivo.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-zinc-900 text-white border border-zinc-700">
        <DialogHeader>
          <DialogTitle>Adicionar Novo Dispositivo</DialogTitle>
          <DialogDescription>
            Preencha os dados do dispositivo para adicioná-lo ao sistema
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Nome */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome do Dispositivo</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Borda-SP-01" {...field} className="bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* IP */}
              <FormField
                control={form.control}
                name="ip"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Endereço IP</FormLabel>
                    <FormControl>
                      <Input placeholder="192.168.1.1" {...field} className="bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Fabricante */}
              <FormField
                control={form.control}
                name="manufacturer"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fabricante</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-zinc-800 text-white border-zinc-700">
                          <SelectValue placeholder="Selecione o fabricante" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {manufacturers.map((manufacturer) => (
                          <SelectItem key={manufacturer} value={manufacturer}>
                            {manufacturer}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Modelo */}
              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Modelo</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: NE40E, ASR9000" {...field} className="bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Credenciais de Acesso */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground border-b border-border pb-2">
                Credenciais de Acesso SSH
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="login"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Usuário</FormLabel>
                      <FormControl>
                        <Input placeholder="admin" {...field} className="bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Senha</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} className="bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Configurações SNMP */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground border-b border-border pb-2">
                Configurações SNMP
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="snmpVersion"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Versão SNMP</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-zinc-800 text-white border-zinc-700">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="v2c">SNMPv2c</SelectItem>
                          <SelectItem value="v3">SNMPv3</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="snmpPort"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Porta SNMP</FormLabel>
                      <FormControl>
                        <Input placeholder="161" {...field} className="bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="snmpCommunity"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Community String</FormLabel>
                      <FormControl>
                        <Input placeholder="public" {...field} className="bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400" />
                      </FormControl>
                      <FormDescription>
                        Community string para acesso SNMP (v2c) ou credenciais SNMPv3
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-700"
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Salvar Dispositivo
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default AddDeviceDialog;
