import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Search, X } from "lucide-react";
import { api } from "@/lib/api";

interface LogViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LogViewer({ open, onOpenChange }: LogViewerProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [totalLines, setTotalLines] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const response = await api.getLogs(500, filter) as any;
      setLogs(response.logs || []);
      setFilteredLogs(response.logs || []);
      setTotalLines(response.totalLines || 0);
    } catch (err) {
      console.error("Failed to load logs:", err);
    } finally {
      setLoading(false);
    }
  };

  const applyFilter = () => {
    if (!filter.trim()) {
      setFilteredLogs(logs);
      return;
    }

    const filterLower = filter.toLowerCase();
    const filtered = logs.filter(line =>
      line.toLowerCase().includes(filterLower)
    );
    setFilteredLogs(filtered);
  };

  const clearFilter = () => {
    setFilter("");
    setFilteredLogs(logs);
  };

  useEffect(() => {
    if (open) {
      loadLogs();
    }
  }, [open]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(loadLogs, 3000); // Refresh every 3 seconds
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoRefresh]);

  useEffect(() => {
    applyFilter();
  }, [filter, logs]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current && autoRefresh) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs, autoRefresh]);

  const getLogLineClass = (line: string) => {
    if (line.includes('[ERROR]') || line.includes('ERROR') || line.includes('error:')) {
      return 'text-red-400';
    }
    if (line.includes('[WARN]') || line.includes('WARNING') || line.includes('warn:')) {
      return 'text-yellow-400';
    }
    if (line.includes('[INFO]') || line.includes('INFO') || line.includes('info:')) {
      return 'text-blue-400';
    }
    if (line.includes('[SUCCESS]') || line.includes('✔')) {
      return 'text-green-400';
    }
    return 'text-gray-300';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Logs da Aplicação</DialogTitle>
          <DialogDescription>
            Visualize logs em tempo real com capacidade de filtro
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filtrar logs por palavra-chave..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-8"
            />
            {filter && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1 h-7 w-7 p-0"
                onClick={clearFilter}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadLogs}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? "Auto ON" : "Auto OFF"}
          </Button>
        </div>

        <div className="flex gap-2 items-center text-sm text-muted-foreground">
          <Badge variant="outline">{totalLines} linhas</Badge>
          {filter && (
            <Badge variant="secondary">
              {filteredLogs.length} filtradas
            </Badge>
          )}
          {autoRefresh && (
            <Badge variant="default" className="animate-pulse">
              Atualizando...
            </Badge>
          )}
        </div>

        <ScrollArea className="flex-1 border rounded-md bg-black/90 p-4" ref={scrollRef}>
          <div className="font-mono text-xs space-y-1">
            {filteredLogs.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                {filter ? "Nenhum log encontrado com o filtro aplicado" : "Nenhum log disponível"}
              </div>
            ) : (
              filteredLogs.map((line, index) => (
                <div
                  key={index}
                  className={`whitespace-pre-wrap break-all ${getLogLineClass(line)}`}
                >
                  {line}
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        <div className="text-xs text-muted-foreground text-center">
          Pressione ESC para fechar | Atualize manualmente ou ative auto-refresh
        </div>
      </DialogContent>
    </Dialog>
  );
}
