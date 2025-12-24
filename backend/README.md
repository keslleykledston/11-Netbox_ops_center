# Netbox Ops Center HUB Backend (FastAPI)

Este é o motor de processamento assíncrono para o Netbox Ops Center.

## Requisitos

- Python 3.9+
- Ambiente virtual (recomendado)

## Instalação

1. Acesse a pasta do backend:
   ```bash
   cd backend
   ```

2. Crie e ative um ambiente virtual:
   ```bash
   python -m venv venv
   source venv/bin/activate  # Linux/Mac
   # ou
   .\venv\Scripts\activate  # Windows
   ```

3. Instale as dependências:
   ```bash
   pip install -r requirements.txt
   ```

## Configuração

O backend lê as configurações do arquivo `.env` na raiz do projeto (com suporte a `.env.local` para sobrescritas). Certifique-se de que as seguintes variáveis estejam configuradas:

```env
NETBOX_URL=...
NETBOX_TOKEN=...
JUMPSERVER_URL=...
JUMPSERVER_TOKEN=...
OXIDIZED_API_URL=...
MOVIDESK_TOKEN=...
DATABASE_URL=postgresql://netbox_ops:netbox_ops@db:5432/netbox_ops
```

## Execução

Para iniciar o servidor em modo de desenvolvimento:

```bash
uvicorn main:app --reload --port 8001
```

O backend estará acessível em `http://localhost:8001`.
A documentação interativa (Swagger) estará em `http://localhost:8001/docs`.


## Endpoints Principais

- `POST /webhooks/movidesk`: Recebe webhooks do Movidesk para criar Tenants no NetBox.
- `GET /audit/jumpserver-missing`: Retorna dispositivos no NetBox que não possuem acesso no JumpServer.
- `GET /backup/status/{device_name}`: Retorna o status consolidado de backup do Oxidized.
- `POST /operations/register-device`: Endpoint para cadastro unificado de novos equipamentos.
