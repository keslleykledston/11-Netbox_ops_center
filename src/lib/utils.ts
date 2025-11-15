import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Sistema de Banco de Dados Local com LocalStorage
export interface Tenant {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  phone?: string;
  document: string; // CNPJ/CPF
  address?: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  tenantId: string;
  username: string;
  email: string;
  password: string;
  role: 'admin' | 'user' | 'viewer';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  tenantId: string;
  name: string;
  hostname: string;
  ipAddress: string;
  deviceType: 'router' | 'switch' | 'firewall' | 'server';
  manufacturer: string;
  model: string;
  osVersion?: string;
  status: 'active' | 'inactive' | 'maintenance';
  location?: string;
  description?: string;
  credentials?: {
    username: string;
    password: string;
    enablePassword?: string;
  };
  snmpVersion?: 'v2c' | 'v3';
  snmpCommunity?: string;
  snmpPort?: number;
  sshPort?: number | null;
  backupEnabled?: boolean;
  credUsername?: string | null;
  hasCredPassword?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Application {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  apiKey: string;
  status: 'connected' | 'disconnected' | 'testing';
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export type InterfaceItem = {
  desc_value: string;
  indice: string;
  name_value: string;
  type: number;
};

export type InterfaceFile = Record<string, InterfaceItem[]>;

export type PeerItem = {
  asn: string;
  ip_peer: string;
  name: string;
  type: number;
  vrf_name: string;
};

export type PeerFile = Record<string, PeerItem[]>;

type DatabaseData = {
  tenants: Tenant[];
  clients: Client[];
  users: User[];
  devices: Device[];
  applications: Application[];
  interfacesByDevice: Record<string, Record<string, InterfaceFile>>;
  peersByDevice: Record<string, Record<string, PeerFile>>;
};

class LocalDatabase {
  private readonly DB_KEY = 'netbox_ops_center_db';
  private readonly TENANTS_KEY = 'tenants';
  private readonly CLIENTS_KEY = 'clients';
  private readonly USERS_KEY = 'users';
  private readonly DEVICES_KEY = 'devices';
  private readonly APPLICATIONS_KEY = 'applications';
  private readonly IFACES_KEY = 'interfacesByDevice';
  private readonly PEERS_KEY = 'peersByDevice';

  constructor() {
    this.initializeDatabase();
  }

  private initializeDatabase() {
    if (!localStorage.getItem(this.DB_KEY)) {
      const initialData: DatabaseData = {
        [this.TENANTS_KEY]: [],
        [this.CLIENTS_KEY]: [],
        [this.USERS_KEY]: [],
        [this.DEVICES_KEY]: [],
        [this.APPLICATIONS_KEY]: [],
        [this.IFACES_KEY]: {},
        [this.PEERS_KEY]: {}
      };
      localStorage.setItem(this.DB_KEY, JSON.stringify(initialData));
    }
  }

  private getData(): DatabaseData {
    const raw = localStorage.getItem(this.DB_KEY);
    if (raw) {
      return JSON.parse(raw) as DatabaseData;
    }
    return {
      [this.TENANTS_KEY]: [],
      [this.CLIENTS_KEY]: [],
      [this.USERS_KEY]: [],
      [this.DEVICES_KEY]: [],
      [this.APPLICATIONS_KEY]: [],
      [this.IFACES_KEY]: {},
      [this.PEERS_KEY]: {}
    };
  }

  private setData(data: DatabaseData) {
    localStorage.setItem(this.DB_KEY, JSON.stringify(data));
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  private ensureDeviceStores(device: Device) {
    const data = this.getData();
    const root = `tenant:${device.tenantId}`;
    if (!data[this.IFACES_KEY][root]) data[this.IFACES_KEY][root] = {};
    if (!data[this.PEERS_KEY][root]) data[this.PEERS_KEY][root] = {};
    if (!data[this.IFACES_KEY][root][device.id]) data[this.IFACES_KEY][root][device.id] = {};
    if (!data[this.PEERS_KEY][root][device.id]) data[this.PEERS_KEY][root][device.id] = {};
    this.setData(data);
  }

  // Tenant Operations
  getTenants(): Tenant[] {
    const data = this.getData();
    return data[this.TENANTS_KEY] || [];
  }

  createTenant(tenant: Omit<Tenant, 'id' | 'createdAt' | 'updatedAt'>): Tenant {
    const data = this.getData();
    const newTenant: Tenant = {
      ...tenant,
      id: this.generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    if (!data[this.TENANTS_KEY]) {
      data[this.TENANTS_KEY] = [];
    }
    
    data[this.TENANTS_KEY].push(newTenant);
    this.setData(data);
    return newTenant;
  }

  updateTenant(id: string, updates: Partial<Omit<Tenant, 'id' | 'createdAt'>>): Tenant | null {
    const data = this.getData();
    const tenants = data[this.TENANTS_KEY] || [];
    const index = tenants.findIndex((t: Tenant) => t.id === id);
    
    if (index === -1) return null;
    
    tenants[index] = {
      ...tenants[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    this.setData(data);
    return tenants[index];
  }

  deleteTenant(id: string): boolean {
    const data = this.getData();
    const tenants = data[this.TENANTS_KEY] || [];
    const filteredTenants = tenants.filter((t: Tenant) => t.id !== id);
    
    if (filteredTenants.length === tenants.length) return false;
    
    data[this.TENANTS_KEY] = filteredTenants;
    this.setData(data);
    return true;
  }

  // Client Operations
  getClients(tenantId?: string): Client[] {
    const data = this.getData();
    const clients = data[this.CLIENTS_KEY] || [];
    return tenantId ? clients.filter((c: Client) => c.tenantId === tenantId) : clients;
  }

  createClient(client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Client {
    const data = this.getData();
    const newClient: Client = {
      ...client,
      id: this.generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    if (!data[this.CLIENTS_KEY]) {
      data[this.CLIENTS_KEY] = [];
    }
    
    data[this.CLIENTS_KEY].push(newClient);
    this.setData(data);
    return newClient;
  }

  updateClient(id: string, updates: Partial<Omit<Client, 'id' | 'createdAt'>>): Client | null {
    const data = this.getData();
    const clients = data[this.CLIENTS_KEY] || [];
    const index = clients.findIndex((c: Client) => c.id === id);
    
    if (index === -1) return null;
    
    clients[index] = {
      ...clients[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    this.setData(data);
    return clients[index];
  }

  deleteClient(id: string): boolean {
    const data = this.getData();
    const clients = data[this.CLIENTS_KEY] || [];
    const filteredClients = clients.filter((c: Client) => c.id !== id);
    
    if (filteredClients.length === clients.length) return false;
    
    data[this.CLIENTS_KEY] = filteredClients;
    this.setData(data);
    return true;
  }

  // User Operations
  getUsers(tenantId?: string): User[] {
    const data = this.getData();
    const users = data[this.USERS_KEY] || [];
    return tenantId ? users.filter((u: User) => u.tenantId === tenantId) : users;
  }

  createUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): User {
    const data = this.getData();
    const newUser: User = {
      ...user,
      id: this.generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    if (!data[this.USERS_KEY]) {
      data[this.USERS_KEY] = [];
    }
    
    data[this.USERS_KEY].push(newUser);
    this.setData(data);
    return newUser;
  }

  updateUser(id: string, updates: Partial<Omit<User, 'id' | 'createdAt'>>): User | null {
    const data = this.getData();
    const users = data[this.USERS_KEY] || [];
    const index = users.findIndex((u: User) => u.id === id);
    
    if (index === -1) return null;
    
    users[index] = {
      ...users[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    this.setData(data);
    return users[index];
  }

  deleteUser(id: string): boolean {
    const data = this.getData();
    const users = data[this.USERS_KEY] || [];
    const filteredUsers = users.filter((u: User) => u.id !== id);
    
    if (filteredUsers.length === users.length) return false;
    
    data[this.USERS_KEY] = filteredUsers;
    this.setData(data);
    return true;
  }

  authenticateUser(username: string, password: string): User | null {
    const users = this.getUsers();
    return users.find(u => u.username === username && u.password === password && u.isActive) || null;
  }

  // Device Operations
  getDevices(tenantId?: string): Device[] {
    const data = this.getData();
    const devices = data[this.DEVICES_KEY] || [];
    return tenantId ? devices.filter((d: Device) => d.tenantId === tenantId) : devices;
  }

  createDevice(device: Omit<Device, 'id' | 'createdAt' | 'updatedAt'>): Device {
    const data = this.getData();
    const newDevice: Device = {
      ...device,
      id: this.generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    if (!data[this.DEVICES_KEY]) {
      data[this.DEVICES_KEY] = [];
    }
    
    data[this.DEVICES_KEY].push(newDevice);
    this.ensureDeviceStores(newDevice);
    this.setData(data);
    return newDevice;
  }

  updateDevice(id: string, updates: Partial<Omit<Device, 'id' | 'createdAt'>>): Device | null {
    const data = this.getData();
    const devices = data[this.DEVICES_KEY] || [];
    const index = devices.findIndex((d: Device) => d.id === id);
    
    if (index === -1) return null;
    
    devices[index] = {
      ...devices[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    this.setData(data);
    return devices[index];
  }

  deleteDevice(id: string): boolean {
    const data = this.getData();
    const devices = data[this.DEVICES_KEY] || [];
    const filteredDevices = devices.filter((d: Device) => d.id !== id);
    
    if (filteredDevices.length === devices.length) return false;
    
    data[this.DEVICES_KEY] = filteredDevices;
    this.setData(data);
    return true;
  }

  // Application Operations
  getApplications(tenantId?: string): Application[] {
    const data = this.getData();
    const applications = data[this.APPLICATIONS_KEY] || [];
    return tenantId ? applications.filter((a: Application) => a.tenantId === tenantId) : applications;
  }

  createApplication(application: Omit<Application, 'id' | 'createdAt' | 'updatedAt'>): Application {
    const data = this.getData();
    const newApplication: Application = {
      ...application,
      id: this.generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    if (!data[this.APPLICATIONS_KEY]) {
      data[this.APPLICATIONS_KEY] = [];
    }
    
    data[this.APPLICATIONS_KEY].push(newApplication);
    this.setData(data);
    return newApplication;
  }

  updateApplication(id: string, updates: Partial<Omit<Application, 'id' | 'createdAt'>>): Application | null {
    const data = this.getData();
    const applications = data[this.APPLICATIONS_KEY] || [];
    const index = applications.findIndex((a: Application) => a.id === id);
    
    if (index === -1) return null;
    
    applications[index] = {
      ...applications[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    this.setData(data);
    return applications[index];
  }

  deleteApplication(id: string): boolean {
    const data = this.getData();
    const applications = data[this.APPLICATIONS_KEY] || [];
    const filteredApplications = applications.filter((a: Application) => a.id !== id);
    
    if (filteredApplications.length === applications.length) return false;
    
    data[this.APPLICATIONS_KEY] = filteredApplications;
    this.setData(data);
    return true;
  }

  // Descoberta e persistência por dispositivo (interfaces e peers)
  getInterfacesFile(deviceId: string): InterfaceFile {
    const data = this.getData();
    const device = (data[this.DEVICES_KEY] || []).find(d => d.id === deviceId);
    if (!device) return {};
    const root = `tenant:${device.tenantId}`;
    return data[this.IFACES_KEY]?.[root]?.[deviceId] ?? {};
  }

  saveInterfacesFile(deviceId: string, file: InterfaceFile) {
    const data = this.getData();
    const device = (data[this.DEVICES_KEY] || []).find(d => d.id === deviceId);
    if (!device) return;
    const root = `tenant:${device.tenantId}`;
    // Garante estrutura mesmo em bancos antigos sem as chaves
    if (!data[this.IFACES_KEY]) data[this.IFACES_KEY] = {} as any;
    if (!data[this.IFACES_KEY][root]) data[this.IFACES_KEY][root] = {};
    data[this.IFACES_KEY][root][deviceId] = file;
    this.setData(data);
  }

  discoverInterfaces(deviceId: string): InterfaceFile {
    const data = this.getData();
    const device = (data[this.DEVICES_KEY] || []).find(d => d.id === deviceId);
    if (!device) return {};
    const group = device.name.split('-')[0] || 'Borda';
    const sample: InterfaceFile = {
      [group]: [
        { desc_value: 'uplink', indice: '1', name_value: 'GigabitEthernet0/1', type: 0 },
        { desc_value: '', indice: '27', name_value: 'NULL0', type: 0 },
      ],
    };
    return sample;
  }

  discoverAndSaveInterfaces(deviceId: string): InterfaceFile {
    const sample = this.discoverInterfaces(deviceId);
    this.saveInterfacesFile(deviceId, sample);
    return sample;
  }

  getPeersFile(deviceId: string): PeerFile {
    const data = this.getData();
    const device = (data[this.DEVICES_KEY] || []).find(d => d.id === deviceId);
    if (!device) return {};
    const root = `tenant:${device.tenantId}`;
    return data[this.PEERS_KEY]?.[root]?.[deviceId] ?? {};
  }

  savePeersFile(deviceId: string, file: PeerFile) {
    const data = this.getData();
    const device = (data[this.DEVICES_KEY] || []).find(d => d.id === deviceId);
    if (!device) return;
    const root = `tenant:${device.tenantId}`;
    if (!data[this.PEERS_KEY]) data[this.PEERS_KEY] = {} as any;
    if (!data[this.PEERS_KEY][root]) data[this.PEERS_KEY][root] = {};
    data[this.PEERS_KEY][root][deviceId] = file;
    this.setData(data);
  }

  discoverPeers(deviceId: string): PeerFile {
    const data = this.getData();
    const device = (data[this.DEVICES_KEY] || []).find(d => d.id === deviceId);
    if (!device) return {};
    const group = device.name.split('-')[0] || 'Borda';
    const sample: PeerFile = {
      [group]: [
        { asn: '269077', ip_peer: '10.20.0.2', name: 'VISION TELECOM', type: 0, vrf_name: 'MAIN' },
        { asn: '4230', ip_peer: '10.20.0.26', name: 'EMBRATEL', type: 0, vrf_name: 'CDN' },
      ],
    };
    return sample;
  }

  discoverAndSavePeers(deviceId: string): PeerFile {
    const sample = this.discoverPeers(deviceId);
    this.savePeersFile(deviceId, sample);
    return sample;
  }

  // Clear all data (for testing)
  clearAll() {
    localStorage.removeItem(this.DB_KEY);
    this.initializeDatabase();
  }
}

export const db = new LocalDatabase();
